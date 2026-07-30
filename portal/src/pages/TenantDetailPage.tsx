import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { callFeatureApi, api } from '../main';

interface FeatureCatalog { tiers: Record<string, string[]>; all: string[]; labels: Record<string, { name: string; description: string }>; }
interface TenantFeatures { tenantId: string; tier: string; overrides: string[]; effectiveFeatures: string[]; }

export function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [catalog, setCatalog] = useState<FeatureCatalog | null>(null);
  const [tf, setTf] = useState<TenantFeatures | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    callFeatureApi('/feature-catalog').then(r => r.json()).then(setCatalog);
    callFeatureApi(`/tenant-features/${tenantId}`).then(r => r.json()).then(setTf);
  }, [tenantId]);

  const toggle = (key: string) => {
    if (!tf) return;
    const isOverride = tf.overrides.includes(key);
    const newOverrides = isOverride ? tf.overrides.filter(f => f !== key) : [...tf.overrides, key];
    setTf({ ...tf, overrides: newOverrides, effectiveFeatures: computeEffective(catalog!, tf.tier, newOverrides) });
  };

  const changeTier = (tier: string) => {
    if (!tf) return;
    setTf({ ...tf, tier, effectiveFeatures: computeEffective(catalog!, tier, tf.overrides) });
  };

  const save = async () => {
    if (!tf) return;
    setSaving(true);
    await callFeatureApi(`/tenant-features/${tenantId}`, {
      method: 'PUT',
      body: JSON.stringify({ tier: tf.tier, overrides: tf.overrides }),
    });
    setSaving(false);
  };

  if (!catalog || !tf) return <div className="p-8 text-slate-500">Cargando…</div>;

  const tierLabels: Record<string, string> = { core: 'Básico', professional: 'Profesional', enterprise: 'Empresarial' };

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white"><div className="max-w-5xl mx-auto px-4 h-14 flex items-center"><Link to="/" className="text-slate-300 hover:text-white text-sm">← Volver</Link></div></header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-semibold mb-4">Gestionar tenant</h2>
        <div className="flex items-center gap-4 mb-6">
          <span className="text-sm text-slate-500">Plan:</span>
          {Object.entries(tierLabels).map(([k, v]) => (
            <button key={k} onClick={() => changeTier(k)} className={`px-3 py-1.5 rounded-md text-sm ${tf.tier === k ? 'bg-emerald-600 text-white' : 'border text-slate-700 hover:bg-slate-100'}`}>{v}</button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {catalog.all.map(key => {
            const label = catalog.labels[key];
            const active = tf.effectiveFeatures.includes(key);
            const inTier = (catalog.tiers[tf.tier] ?? []).includes(key);
            return (
              <div key={key} className={`rounded-xl border p-3 flex items-center justify-between ${active ? 'border-emerald-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                <div>
                  <div className="text-sm font-medium">{label.name}</div>
                  <div className="text-xs text-slate-500">{label.description}</div>
                  {!inTier && <span className="text-xs text-amber-600">Anulación personalizada</span>}
                </div>
                <button
                  onClick={() => toggle(key)}
                  disabled={!inTier && !active}
                  className={`w-10 h-6 rounded-full relative ${active ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${active ? 'left-5' : 'left-0.5'}`}></span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end">
          <button onClick={save} disabled={saving} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </main>
    </div>
  );
}

function computeEffective(catalog: FeatureCatalog, tier: string, overrides: string[]): string[] {
  const base = catalog.tiers[tier] ?? catalog.tiers.core;
  return Array.from(new Set([...base, ...overrides.filter(f => catalog.all.includes(f))]));
}