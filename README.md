# SBT Control Plane — SaaS EHR Multi-Tenant

Plano de control del demo SaaS EHR. Orquesta el onboarding de tenants, gestiona el catálogo, asigna tiers y propaga cambios de feature flags hacia los planos de aplicación mediante EventBridge.

## Arquitectura

```
┌─ DnsFoundationStack ─────────────────────────────────────────┐
│  zona pruebas.aws.gerardocastillo.me + delegación NS          │
│  certificado ACM wildcard *.pruebas.aws.gerardocastillo.me    │
│  SSM → /sbt-demo-ehr/{hosted-zone-id,root-domain,cert}       │
└────────────────────────────┬─────────────────────────────────┘
┌─ ControlPlaneStack ───────┼──────────────────────────────────┐
│  sbt.CognitoAuth (admin pool) + sbt.ControlPlane (API REST)  │
│  TenantFeatureService (DynamoDB + Lambda + HTTP API)         │
│  EventBus → SSM → /sbt-demo-ehr/event-bus-name               │
└────────────────────────────┼──────────────────────────────────┘
┌─ AppPlaneStack ───────────┼──────────────────────────────────┐
│  sbt.CoreApplicationPlane + ProvisioningScriptJob            │
│    (CodeBuild → cdk deploy EhrTenantStack-<id>)              │
│  + DeprovisioningScriptJob (CodeBuild → cdk destroy)         │
│  S3 artifacts bucket + SSM → /sbt-demo-ehr/artifacts-bucket  │
└────────────────────────────┼──────────────────────────────────┘
┌─ AdminPortalStack ────────┼──────────────────────────────────┐
│  React SPA (español) en S3 + CloudFront + admin.<zona>       │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisitos

- Node.js ≥ 20, npm
- AWS CDK CLI ≥ 2.1100
- Docker (necesario para `cdk synth` y `cdk deploy` — los constructos de SBT empaquetan Lambdas con Docker)
- Cuenta AWS con permisos AdministratorAccess (`cdk bootstrap` ejecutado previamente)

## Despliegue ordenado

```bash
npm install

# 1. DNS Foundation
npx cdk deploy SbtEhrDnsFoundationStack
# Esperar propagación de NS (~5 min) y validación del certificado ACM

# 2. Control Plane + Feature Service
npx cdk deploy SbtEhrControlPlaneStack --context adminEmail=tu-email@ejemplo.com
# El admin de Cognito recibe un email con la contraseña temporal

# 3. Subir artefacto del tenant (desde el otro repo: ehr-tenant-app)
export ARTIFACTS_BUCKET=sbt-demo-ehr-artifacts-772961519025
export APP_VERSION=1.0.0
cd ../ehr-tenant-app && bash scripts/package-infra.sh

# 4. App Plane (provisioning/deprovisioning jobs)
npx cdk deploy SbtEhrAppPlaneStack

# 5. Construir y subir el portal
npm --prefix portal install
npm --prefix portal run build
npx cdk deploy SbtEhrAdminPortalStack

# 6. Inyectar config.json en el bucket del portal
bash scripts/write-portal-config.sh
```

## Flujo de demo

1. Abrir `https://admin.pruebas.aws.gerardocastillo.me` → login con Cognito (credenciales del email configurado).
2. **Nuevo tenant** → nombre "Clínica Alfa", email del admin, plan "Básico".
3. Esperar ~15-20 min (provisionamiento: VPC + Aurora + Cognito + Lambda).
4. El tenant aparece como "Activo" con su URL `https://clinica-alfa-xxxxx.pruebas.aws.gerardocastillo.me`.
5. Hacer clic en **Gestionar** → cambiar plan o activar una anulación personalizada (ej. `Telemedicina` para un tenant Core).
6. En segundos, el módulo de Telemedicina aparece en el EHR del tenant.

## Eventos personalizados

| Evento | Source | DetailType | Detail |
|---|---|---|---|
| TenantFeatureUpdated | `controlPlaneEventSource` | `TenantFeatureUpdated` | `{tenantId, tier, overridesB64}` |

La Feature Service emite este evento al bus de SBT cada vez que un administrador guarda cambios de plan o anulaciones.

## Costos

- Control Plane (sin tenants activos): ~$15-20/mes (Lambdas, API Gateway, DynamoDB, CloudFront, S3)
- Cada tenant activo: ~$65/mes (Aurora, NAT instance, RDS Proxy)
- El provisioning/deprovisioning usa CodeBuild bajo demanda (~$0.005/min, típicamente < $2 por operación)