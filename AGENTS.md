# AGENTS.md — sbt-control-plane

## Purpose
Control plane for the multi-tenant EHR SaaS demo. Uses AWS SaaS Builder Toolkit (`@cdklabs/sbt-aws` v0.9.5) for tenant management, a custom feature-flag service (DynamoDB + Lambda + HTTP API) for tier/override management, and a React SPA admin portal (Spanish UI). Tenants are onboarded via SBT's `ProvisioningScriptJob` which runs `cdk deploy` of the tenant stack from the `ehr-tenant-app` repo.

## Directory Map
```
├── bin/control-plane.ts             # CDK app wiring 4 stacks
├── lib/
│   ├── dns-foundation-stack.ts     # Hosted zone + delegation + wildcard ACM + SSM
│   ├── control-plane-stack.ts      # sbt.CognitoAuth + sbt.ControlPlane + FeatureService
│   ├── constructs/feature-service.ts # DDB + Lambda + HTTP API (JWT authorizer)
│   ├── app-plane-stack.ts          # CoreApplicationPlane + Provisioning/Deprovisioning jobs
│   └── admin-portal-stack.ts       # S3 + CloudFront + Route53 alias
├── src/feature-service/handler.ts   # Lambda: GET/PUT tenant-features, emits EventBridge
├── scripts/
│   ├── provision-tenant.sh          # CodeBuild bash: bootstrap Node/PHP, cdk deploy
│   ├── deprovision-tenant.sh        # CodeBuild bash: cdk destroy
│   └── write-portal-config.sh       # Upload config.json to portal bucket
├── portal/                          # Vite + React 18 + Tailwind (Spanish)
│   ├── src/pages/{TenantsPage,OnboardPage,TenantDetailPage,LoginPage}.tsx
│   └── src/main.tsx                 # Amplify v6 auth + routing + API client
├── test/control-plane.test.ts       # Jest: 4 synth-assertion tests
├── cdk.json                         # Context: adminEmail, tenantInfraVersion
└── tsconfig.json
```

## Build & Test Commands
```bash
npm install                     # All CDK + dev deps
npx tsc --noEmit               # TypeScript compilation check
npm test                        # Jest (4 tests — may need Docker for synth)
npx cdk synth --all             # Full synth (REQUIRES Docker)
npm --prefix portal install     # Portal deps
npm --prefix portal run build   # Portal build → portal/dist/
```

## Architecture Rules
1. **SBT version**: v0.9.5 (check `node_modules/@cdklabs/sbt-aws` for APIs — do not guess).
2. **Never SSM lookups at synth** — cross-stack references use object props, not SSM. SSM is for runtime (provisioning shell scripts read params with `aws ssm`).
3. **UI Spanish, code English** — Portal pages use Spanish labels; all TS/JS use English.
4. **Admin email** is REQUIRED as CDK context (`--context adminEmail=...`). Default in `cdk.json`.
5. **Provisioning script** is `scripts/provision-tenant.sh`. It boots Node 20 + PHP + Composer, downloads the tenant app artifact, runs `cdk deploy`, creates the tenant admin Cognito user, and invokes the artisan Lambda for migrations + initial feature sync.
6. **Deprovisioning script** empties the S3 bucket then runs `cdk destroy --force`.
7. **DEMO-ONLY permissions**: the provisioning CodeBuild role has `actions:* resources:*`. Replace with least privilege for production.
8. **Event bus**: SBT creates a custom event bus. Bus name is written to SSM `/sbt-demo-ehr/event-bus-name`. The tenant stack reads it from context (provisioning passes it).
9. **Custom event** `TenantFeatureUpdated` is emitted by the feature-service Lambda (source: `controlPlaneEventSource`). Detail: `{tenantId, tier, overridesB64}` where `overridesB64` = base64(JSON array of feature keys).
10. **Cognito domain**: Do NOT create a second `UserPoolDomain`. SBT's `CognitoAuth` already creates one. Access it via `cognitoAuth.node.findChild('UserPoolDomain') as cognito.UserPoolDomain`. The full domain is `${domainPrefix}.auth.${region}.amazoncognito.com`.
11. **CORS**: The ControlPlane API needs `apiCorsConfig` allowing the admin portal origin (`https://admin.pruebas.aws.gerardocastillo.me`). Without this, browser requests fail silently.
12. **Portal API client**: The control plane API URL has a trailing `/`. The portal `api()` function must strip it before concatenating paths: `apiUrl.replace(/\/+$/, '') + path`. Always handle errors with `.catch()` to avoid eternal loading states.
13. **Portal config.json**: After `aws s3 sync --delete` on the portal bucket, `config.json` is DELETED. Run `scripts/write-portal-config.sh` to restore it.

## Feature Catalog
The tier matrix is **duplicated** in both `src/feature-service/handler.ts` (for the admin portal display) and `ehr-tenant-app/config/features.php` (source of truth). If you change the matrix, update both places.

## Contract (must match ehr-tenant-app)
- `tenantConfig` JSON exported by provisioning: `{userPoolId, appClientId, cognitoDomain, apiUrl, bucketName, subdomain}`
- Tenant stack outputs (read by provisioning from `outputs.json`): `UserPoolId`, `AppClientId`, `CognitoDomain`, `ApiUrl`, `BucketName`, `Subdomain`, `ArtisanFunctionName`, `WebFunctionName`
- CDK context values passed by provisioning: `tenantId`, `tenantName`, `subdomain`, `tier`, `adminEmail`, `hostedZoneId`, `rootDomain`, `wildcardCertificateArn`, `eventBusName`
- The tenant app uses **Aurora MySQL** (not PostgreSQL) because Bref's php-83-fpm layer does not include pdo_pgsql. Lambda connects to the cluster endpoint **directly** (no RDS Proxy).

## Deploy Order
1. DnsFoundationStack (zone + cert)
2. ControlPlaneStack (auth + API + feature-service)
3. Upload tenant artifact (ehr-tenant-app/scripts/package-infra.sh)
4. AppPlaneStack (provisioning jobs)
5. Portal build (`npm --prefix portal run build`)
6. AdminPortalStack + write-portal-config.sh

## Teardown Order
1. AdminPortalStack
2. AppPlaneStack
3. ControlPlaneStack
4. DnsFoundationStack (may need manual CNAME cleanup in Route53)