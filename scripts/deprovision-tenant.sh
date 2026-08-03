#!/usr/bin/env bash
set -euo pipefail

echo "========== Deprovisioning tenant: ${tenantId} =========="

STACK_NAME="EhrTenantStack-${tenantId}"

# Empty the S3 bucket before destroy to avoid FORCE_DELETE_BUCKET issues
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text 2>/dev/null || true)
if [ -n "${BUCKET_NAME:-}" ]; then
  aws s3 rm "s3://${BUCKET_NAME}" --recursive || echo "[deprovision-tenant] S3 empty skipped."
fi

# Use CloudFormation directly — avoids CDK context issues with npx cdk
aws cloudformation delete-stack --stack-name "$STACK_NAME"
echo "[deprovision-tenant] Stack deletion initiated for ${STACK_NAME}."

export registrationStatus="deleted"
echo "========== TENANT DEPROVISIONED: ${tenantId} =========="
