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
│  CORS habilitado para el portal admin                         │
│  EventBus → SSM → /sbt-demo-ehr/event-bus-name               │
└────────────────────────────┼──────────────────────────────────┘
┌─ AppPlaneStack ───────────┼──────────────────────────────────┐
│  sbt.CoreApplicationPlane + ProvisioningScriptJob            │
│    (CodeBuild → cdk deploy EhrTenantStack-<id>)              │
│  + DeprovisioningScriptJob (CodeBuild → delete-stack)         │
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
cdk bootstrap

# 1. DNS Foundation
npx cdk deploy SbtEhrDnsFoundationStack
# Esperar propagación de NS (~5 min) y validación del certificado ACM

# 2. Control Plane + Feature Service
npx cdk deploy SbtEhrControlPlaneStack --context adminEmail=tu-email@ejemplo.com
# El admin de Cognito recibe un email con la contraseña temporal

# 3. App Plane (creates the S3 artifacts bucket + provisioning/deprovisioning jobs)
npx cdk deploy SbtEhrAppPlaneStack

# 4. Subir artefacto del tenant (desde el otro repo: ehr-tenant-app)
#    NOTA: debe ejecutarse después del paso 3 porque el bucket lo crea AppPlaneStack
export ARTIFACTS_BUCKET=sbt-demo-ehr-artifacts-$(aws sts get-caller-identity --query Account --output text)
export APP_VERSION=1.0.0
bash ../ehr-tenant-app/scripts/package-infra.sh

# 5. Construir y subir el portal
npm --prefix portal install
npm --prefix portal run build
npx cdk deploy SbtEhrAdminPortalStack

# 6. Inyectar config.json en el bucket del portal
bash scripts/write-portal-config.sh
```

## Flujo de demo

1. Abrir `https://admin.pruebas.aws.gerardocastillo.me` → login con Cognito (credenciales del email configurado, cambiar contraseña al primer ingreso).
2. **Nuevo tenant** → nombre "Clínica Alfa", email del admin, plan "Básico".
3. Esperar ~10-15 min (provisionamiento: VPC + Aurora + Cognito + Lambda).
4. El tenant aparece como "Activo" con su URL `https://clinica-alfa-xxxxx.pruebas.aws.gerardocastillo.me`.
5. Hacer clic en **Gestionar** → cambiar plan o activar una anulación personalizada (ej. `Telemedicina` para un tenant Core).
6. En segundos, el módulo de Telemedicina aparece en el EHR del tenant.

## Eventos personalizados

| Evento | Source | DetailType | Detail |
|---|---|---|---|
| TenantFeatureUpdated | `controlPlaneEventSource` | `TenantFeatureUpdated` | `{tenantId, tier, overridesB64}` |

La Feature Service emite este evento al bus de SBT cada vez que un administrador guarda cambios de plan o anulaciones.

## Decisiones técnicas importantes

- **CORS en la API del Control Plane**: Configurado para permitir `https://admin.pruebas.aws.gerardocastillo.me` y `http://localhost:5173`. Sin CORS, el portal admin no puede llamar a la API desde el navegador.
- **Dominio de Cognito**: SBT's `CognitoAuth` ya crea su propio `UserPoolDomain`. No agregar uno duplicado — usar el existente vía `cognitoAuth.node.findChild('UserPoolDomain')`. El dominio completo se forma como `<prefix>.auth.<region>.amazoncognito.com`.
- **Portal config.json**: Se inyecta después del deploy con `scripts/write-portal-config.sh`. No incluir `config.json` en el `aws s3 sync --delete` del portal o se borrará.
- **API Gateway doble slash**: El `apiUrl` del Control Plane incluye `/` al final. El portal debe hacer `apiUrl.replace(/\/+$/, '')` antes de concatenar con el path.
- **Portal error handling**: Las llamadas a la API deben tener manejo de errores (`.catch`) para evitar estados "Cargando..." eternos.
- **Provisioning script**: The bash script run by CodeBuild needs Node ≥ 20 and AWS CLI. PHP and Composer are NOT required — the tenant app artifact includes pre-bundled vendor dependencies. The deprovisioning script uses `aws cloudformation delete-stack` directly (not `npx cdk destroy`) to avoid CDK context issues.
- **Bref Console payload format**: El Lambda artisan de Bref espera `{"cli":"comando --args"}` (NO `{"command":"..."}`). El formato `command` es ignorado silenciosamente (retorna help text sin error). El provision script y las reglas de EventBridge deben usar `cli`.
- **Artifact bucket versionado**: `s3://<account>-artifacts-bucket/tenant-app/<version>/app.zip`. El versionado permite desplegar múltiples versiones de la app tenant. Bump `tenantInfraVersion` en `cdk.json` al publicar una nueva versión.
- **SSM Parameter Store** (`/sbt-demo-ehr/`): Namespace aislado para referencias cross-stack: `hosted-zone-id`, `root-domain`, `wildcard-certificate-arn` (DnsFoundation → AppPlane), `event-bus-name` (ControlPlane → AppPlane), `artifacts-bucket-name`, `tenant-infra-version` (AppPlane → CodeBuild). CodeBuild no puede recibir props de CDK, por eso usa SSM como puente.
- **Bref + Pennant incompatibility**: The tenant app works around a Pennant/Bref FPM Lambda issue (see `ehr-tenant-app/AGENTS.md` § Architecture Rule 3 for details). Feature reads use a direct DB query; the sync command still writes via `Feature::activate()`.
- **SBT EventBridge callback**: SBT sets up OAuth machine-to-machine credentials for the EventBridge → ControlPlane API connection (tenant registration status updates). The connection is AUTHORIZED and functional — "En progreso" status is typically a timing issue, not an auth failure.

## Costos

- Control Plane (sin tenants activos): ~$15-20/mes (Lambdas, API Gateway, DynamoDB, CloudFront, S3)
- Cada tenant activo: ~$52/mes (Aurora MySQL, NAT Gateway, Lambda, S3, Cognito)
- El provisioning/deprovisioning usa CodeBuild bajo demanda (~$0.005/min, típicamente < $2 por operación)

## Teardown

```bash
npx cdk destroy SbtEhrAdminPortalStack
npx cdk destroy SbtEhrAppPlaneStack
npx cdk destroy SbtEhrControlPlaneStack
npx cdk destroy SbtEhrDnsFoundationStack
```

Si `SbtEhrDnsFoundationStack` falla con `HostedZoneNotEmptyException`, eliminar manualmente los registros CNAME de validación ACM de la zona antes de reintentar.
