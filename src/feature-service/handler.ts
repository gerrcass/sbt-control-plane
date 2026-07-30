import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ddb = new DynamoDBClient({});
const eb = new EventBridgeClient({});

const TABLE_NAME = process.env.TABLE_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const EVENT_SOURCE = process.env.EVENT_SOURCE!;
const EVENT_DETAIL_TYPE = process.env.EVENT_DETAIL_TYPE!;

// Tier matrix (display copy — source of truth is ehr-tenant-app config/features.php)
const TIERS: Record<string, string[]> = {
  core: [
    'patient_management',
    'appointment_scheduling',
    'medical_prescriptions',
    's3_document_storage',
  ],
  professional: [
    'patient_management',
    'appointment_scheduling',
    'medical_prescriptions',
    's3_document_storage',
    'occupational_health',
    'electronic_signature',
    'lab_results_integration',
    'telemedicine',
  ],
  enterprise: [
    'patient_management',
    'appointment_scheduling',
    'medical_prescriptions',
    's3_document_storage',
    'occupational_health',
    'electronic_signature',
    'lab_results_integration',
    'telemedicine',
    'hospitalization_beds',
    'insurance_billing',
    'advanced_analytics',
    'custom_audit_logs',
  ],
};

const ALL_FEATURES = Object.keys(TIERS.enterprise.reduce((acc, f) => ({ ...acc, [f]: true }), {} as Record<string, boolean>));

const LABELS_ES: Record<string, { name: string; description: string; group: string }> = {
  patient_management: { name: 'Expediente Clínico', description: 'Expediente clínico electrónico de pacientes.', group: 'core' },
  appointment_scheduling: { name: 'Citas Médicas', description: 'Gestión de citas médicas y agenda.', group: 'core' },
  medical_prescriptions: { name: 'Recetas', description: 'Emisión de recetas médicas.', group: 'core' },
  s3_document_storage: { name: 'Documentos (S3)', description: 'Carga de archivos clínicos en S3.', group: 'core' },
  occupational_health: { name: 'Salud Ocupacional', description: 'Fichas médicas ocupacionales.', group: 'professional' },
  electronic_signature: { name: 'Firma Digital', description: 'Firma digital en recetas e informes.', group: 'professional' },
  lab_results_integration: { name: 'Laboratorio', description: 'Resultados de exámenes.', group: 'professional' },
  telemedicine: { name: 'Telemedicina', description: 'Videollamadas y consultas virtuales.', group: 'professional' },
  hospitalization_beds: { name: 'Hospitalización', description: 'Control de camas y quirófanos.', group: 'enterprise' },
  insurance_billing: { name: 'Facturación', description: 'Facturación médica con aseguradoras.', group: 'enterprise' },
  advanced_analytics: { name: 'Analítica', description: 'Dashboard estadístico e indicadores.', group: 'enterprise' },
  custom_audit_logs: { name: 'Auditoría', description: 'Trazabilidad y auditoría aumentada.', group: 'enterprise' },
};

function computeEffective(tier: string, overrides: string[]): string[] {
  const base = TIERS[tier] ?? TIERS.core;
  const merged = new Set([...base, ...overrides.filter((f) => ALL_FEATURES.includes(f))]);
  return Array.from(merged);
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function handler(event: any) {
  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath ?? event.requestContext?.http?.path;
    const tenantId = event.pathParameters?.tenantId as string | undefined;

    if (path === '/feature-catalog' && method === 'GET') {
      return json(200, { tiers: TIERS, all: ALL_FEATURES, labels: LABELS_ES });
    }

    if (!tenantId) {
      return json(400, { message: 'tenantId requerido.' });
    }

    if (method === 'GET') {
      const result = await ddb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { tenantId: { S: tenantId } },
      }));

      const tier = result.Item?.tier?.S ?? 'core';
      const overrides: string[] = result.Item?.overrides?.S
        ? JSON.parse(result.Item.overrides.S)
        : [];

      return json(200, {
        tenantId,
        tier,
        overrides,
        effectiveFeatures: computeEffective(tier, overrides),
      });
    }

    if (method === 'PUT') {
      const body = event.body ? JSON.parse(event.body) : {};
      const { tier, overrides } = body as { tier?: string; overrides?: string[] };

      if (tier && !['core', 'professional', 'enterprise'].includes(tier)) {
        return json(400, { message: 'El plan debe ser core, professional o enterprise.' });
      }
      if (
        overrides &&
        (!Array.isArray(overrides) || overrides.some((f: any) => typeof f !== 'string' || !ALL_FEATURES.includes(f)))
      ) {
        return json(400, { message: 'Las anulaciones personalizadas deben ser un arreglo de claves de feature válidas.' });
      }

      const current = await ddb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { tenantId: { S: tenantId } },
      }));

      const resolvedTier = tier ?? current.Item?.tier?.S ?? 'core';
      const resolvedOverrides = overrides ?? (current.Item?.overrides?.S ? JSON.parse(current.Item.overrides.S) : []);

      await ddb.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: {
          tenantId: { S: tenantId },
          tier: { S: resolvedTier },
          overrides: { S: JSON.stringify(resolvedOverrides) },
          updatedAt: { S: new Date().toISOString() },
        },
      }));

      const overridesB64 = Buffer.from(JSON.stringify(resolvedOverrides)).toString('base64');

      await eb.send(new PutEventsCommand({
        Entries: [
          {
            EventBusName: EVENT_BUS_NAME,
            Source: EVENT_SOURCE,
            DetailType: EVENT_DETAIL_TYPE,
            Detail: JSON.stringify({
              tenantId,
              tier: resolvedTier,
              overridesB64,
            }),
          },
        ],
      }));

      return json(200, {
        tenantId,
        tier: resolvedTier,
        overrides: resolvedOverrides,
        effectiveFeatures: computeEffective(resolvedTier, resolvedOverrides),
      });
    }

    return json(405, { message: 'Método no permitido.' });
  } catch (e: any) {
    console.error(e);
    return json(500, { message: 'Error interno del servidor.' });
  }
}