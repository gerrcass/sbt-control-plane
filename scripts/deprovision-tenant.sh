#!/usr/bin/env bash
set -euo pipefail

echo "========== Deprovisioning tenant: ${tenantId} =========="

HOSTED_ZONE_ID=$(aws ssm get-parameter --name /sbt-demo-ehr/hosted-zone-id --query Parameter.Value --output text)
ROOT_DOMAIN=$(aws ssm get-parameter --name /sbt-demo-ehr/root-domain --query Parameter.Value --output text)
CERT_ARN=$(aws ssm get-parameter --name /sbt-demo-ehr/wildcard-certificate-arn --query Parameter.Value --output text)
BUS_NAME=$(aws ssm get-parameter --name /sbt-demo-ehr/event-bus-name --query Parameter.Value --output text)

STACK_NAME="EhrTenantStack-${tenantId}"

# Optional: empty the S3 bucket before destroy to avoid FORCE_DELETE_BUCKET issues
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text 2>/dev/null || true)
if [ -n "${BUCKET_NAME:-}" ]; then
  aws s3 rm "s3://${BUCKET_NAME}" --recursive || echo "[deprovision-tenant] S3 empty skipped."
fi

# Toolchain bootstrap (same as provisioning)
if ! node --version | grep -q 'v2[0-9]'; then npm install -g n && n 20 && hash -r; fi
if ! command -v php >/dev/null 2>&1; then apt-get update -y && apt-get install -y php-cli php-xml php-mbstring php-curl php-zip unzip; fi
if ! command -v composer >/dev/null 2>&1; then curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer; fi

aws s3 cp "s3://${ARTIFACTS_BUCKET}/tenant-app/${APP_VERSION}/app.zip" /tmp/app.zip
rm -rf /tmp/tenant-app
mkdir -p /tmp/tenant-app
cd /tmp/tenant-app
unzip -q /tmp/app.zip
npm --prefix infra ci

# Recompute the same subdomain so cdk destroy has the same parameters
tenantName="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Parameters[?ParameterKey=='tenantName'].ParameterValue" --output text 2>/dev/null || echo "$tenantId")"
SLUG=$(echo "$tenantName" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-\|-$//g' | cut -c1-30)
SUBDOMAIN="${SLUG}-$(echo "$tenantId" | cut -c1-6)"

cd infra
npx cdk destroy "$STACK_NAME" --force \
  --context "tenantId=${tenantId}" \
  --context "tenantName=${tenantName}" \
  --context "subdomain=${SUBDOMAIN}" \
  --context "tier=${tier}" \
  --context "adminEmail=${email}" \
  --context "hostedZoneId=${HOSTED_ZONE_ID}" \
  --context "rootDomain=${ROOT_DOMAIN}" \
  --context "wildcardCertificateArn=${CERT_ARN}" \
  --context "eventBusName=${BUS_NAME}" || echo "[deprovision-tenant] cdk destroy returned non-zero — stack may already be deleted."

export registrationStatus="deleted"
echo "========== TENANT DEPROVISIONED: ${tenantId} =========="