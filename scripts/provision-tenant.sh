#!/usr/bin/env bash
set -euo pipefail

echo "========== Provisioning tenant: ${tenantId} (${tenantName}) tier=${tier} =========="

# ------------------------------------------------------------------
# 1. Toolchain
# ------------------------------------------------------------------
if ! brew --version >/dev/null 2>&1 && ! npx --version >/dev/null 2>&1; then
  echo "No Node found — installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! node --version | grep -q 'v2[0-9]'; then
  npm install -g n && n 20 && hash -r
fi

if ! command -v php >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y php-cli php-xml php-mbstring php-curl php-zip unzip
fi
if ! command -v composer >/dev/null 2>&1; then
  curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
fi

# ------------------------------------------------------------------
# 2. Cross-repo configuration (SSM)
# ------------------------------------------------------------------
HOSTED_ZONE_ID=$(aws ssm get-parameter --name /sbt-demo-ehr/hosted-zone-id --query Parameter.Value --output text)
ROOT_DOMAIN=$(aws ssm get-parameter --name /sbt-demo-ehr/root-domain --query Parameter.Value --output text)
CERT_ARN=$(aws ssm get-parameter --name /sbt-demo-ehr/wildcard-certificate-arn --query Parameter.Value --output text)
BUS_NAME=$(aws ssm get-parameter --name /sbt-demo-ehr/event-bus-name --query Parameter.Value --output text)

echo "ROOT_DOMAIN=${ROOT_DOMAIN}  BUS=${BUS_NAME}"

# ------------------------------------------------------------------
# 3. Download and prepare the tenant application artifact
# ------------------------------------------------------------------
aws s3 cp "s3://${ARTIFACTS_BUCKET}/tenant-app/${APP_VERSION}/app.zip" /tmp/app.zip
rm -rf /tmp/tenant-app
mkdir -p /tmp/tenant-app
cd /tmp/tenant-app
unzip -q /tmp/app.zip

bash scripts/package-app.sh
npm --prefix infra ci

# ------------------------------------------------------------------
# 4. Subdomain slug
# ------------------------------------------------------------------
SLUG=$(echo "$tenantName" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g' | cut -c1-30)
SUBDOMAIN="${SLUG}-$(echo "$tenantId" | cut -c1-6)"

echo "Subdomain: ${SUBDOMAIN}.${ROOT_DOMAIN}"

# ------------------------------------------------------------------
# 5. CDK deploy tenant silo stack
# ------------------------------------------------------------------
cd infra
STACK_NAME="EhrTenantStack-${tenantId}"

npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  --outputs-file /tmp/outputs.json \
  --context "tenantId=${tenantId}" \
  --context "tenantName=${tenantName}" \
  --context "subdomain=${SUBDOMAIN}" \
  --context "tier=${tier}" \
  --context "adminEmail=${email}" \
  --context "hostedZoneId=${HOSTED_ZONE_ID}" \
  --context "rootDomain=${ROOT_DOMAIN}" \
  --context "wildcardCertificateArn=${CERT_ARN}" \
  --context "eventBusName=${BUS_NAME}"

# ------------------------------------------------------------------
# 6. Collect stack outputs
# ------------------------------------------------------------------
USER_POOL_ID=$(jq -r ".\"${STACK_NAME}\".UserPoolId" /tmp/outputs.json)
APP_CLIENT_ID=$(jq -r ".\"${STACK_NAME}\".AppClientId" /tmp/outputs.json)
COGNITO_DOMAIN=$(jq -r ".\"${STACK_NAME}\".CognitoDomain" /tmp/outputs.json)
API_URL=$(jq -r ".\"${STACK_NAME}\".ApiUrl" /tmp/outputs.json)
BUCKET_NAME=$(jq -r ".\"${STACK_NAME}\".BucketName" /tmp/outputs.json)
ARTISAN_FN=$(jq -r ".\"${STACK_NAME}\".ArtisanFunctionName" /tmp/outputs.json)

# ------------------------------------------------------------------
# 7. Create tenant admin user in Cognito
# ------------------------------------------------------------------
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$email" \
  --user-attributes "Name=email,Value=${email}" "Name=email_verified,Value=true" "Name=custom:tenantId,Value=${tenantId}" \
  || echo "[provision-tenant] admin-create-user skipped (may already exist)."

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$email" \
  --group-name TenantAdmin \
  || echo "[provision-tenant] admin-add-user-to-group skipped."

# ------------------------------------------------------------------
# 8. Initialise the database + seed + feature sync (with cold-Aurora retry)
# ------------------------------------------------------------------
invoke_console() {
  local PAYLOAD_FILE="/tmp/console_payload.json"
  echo -n "$1" > "$PAYLOAD_FILE"
  aws lambda invoke \
    --function-name "$ARTISAN_FN" \
    --cli-binary-format raw-in-base64-out \
    --payload "file://${PAYLOAD_FILE}" \
    /tmp/console_result.json
}

wait_for_lambda() {
  for i in $(seq 1 6); do
    invoke_console '{"command":"migrate --force --seed"}'
    if jq -e '.FunctionError' /tmp/console_result.json > /dev/null 2>&1; then
      echo "Migration attempt ${i} failed (Aurora may still be warming up); waiting 30s..."
      sleep 30
    else
      echo "Migration/seed succeeded on attempt ${i}."
      return 0
    fi
  done
  echo "ERROR: Migration never succeeded after 6 retries."
  return 1
}

wait_for_lambda

invoke_console "{\"command\":\"sbt:sync-tenant-features --tenant-id=${tenantId} --tier=${tier}\"}"
echo "Initial feature sync dispatched."

# ------------------------------------------------------------------
# 9. Export result contract to the outgoing EventBridge event
# ------------------------------------------------------------------
export tenantConfig
tenantConfig=$(jq -nc \
  --arg userPoolId "$USER_POOL_ID" \
  --arg appClientId "$APP_CLIENT_ID" \
  --arg cognitoDomain "$COGNITO_DOMAIN" \
  --arg apiUrl "$API_URL" \
  --arg bucketName "$BUCKET_NAME" \
  --arg subdomain "$SUBDOMAIN" \
  '{userPoolId:$userPoolId, appClientId:$appClientId, cognitoDomain:$cognitoDomain, apiUrl:$apiUrl, bucketName:$bucketName, subdomain:$subdomain}')

export tenantStatus="created"

echo "========== TENANT PROVISIONED: ${tenantId} =========="
echo "tenantConfig=${tenantConfig}"
echo "tenantStatus=${tenantStatus}"