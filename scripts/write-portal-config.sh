#!/usr/bin/env bash
set -euo pipefail

echo "=== write-portal-config.sh — escribiendo config.json en el bucket del portal ==="

CP_STACK="SbtEhrControlPlaneStack"
PORTAL_STACK="SbtEhrAdminPortalStack"

get_output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text 2>/dev/null || true
}

USER_POOL_ID=$(get_output "$CP_STACK" UserPoolId)
USER_POOL_CLIENT_ID=$(get_output "$CP_STACK" UserPoolClientId)
COGNITO_DOMAIN=$(get_output "$CP_STACK" CognitoDomain)
CONTROL_PLANE_API_URL=$(get_output "$CP_STACK" ControlPlaneApiUrl)
FEATURE_API_URL=$(get_output "$CP_STACK" FeatureApiUrl)
PORTAL_BUCKET=$(get_output "$PORTAL_STACK" PortalBucketName)
REGION="us-east-1"

if [ -z "${PORTAL_BUCKET:-}" ]; then
  echo "ERROR: No se pudo obtener el bucket del portal desde la stack ${PORTAL_STACK}."
  exit 1
fi

CONFIG_FILE="/tmp/portal_config.json"
cat > "$CONFIG_FILE" <<EOF
{
  "region": "${REGION}",
  "userPoolId": "${USER_POOL_ID}",
  "userPoolClientId": "${USER_POOL_CLIENT_ID}",
  "cognitoDomain": "${COGNITO_DOMAIN}",
  "controlPlaneApiUrl": "${CONTROL_PLANE_API_URL}",
  "featureApiUrl": "${FEATURE_API_URL}"
}
EOF

echo "Cargando config.json en s3://${PORTAL_BUCKET}/config.json"
aws s3 cp "$CONFIG_FILE" "s3://${PORTAL_BUCKET}/config.json" \
  --content-type application/json

echo "[write-portal-config.sh] Listo."