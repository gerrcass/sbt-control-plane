import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../main';

interface Tenant { tenantId: string; tenantName: string; tier: string; tenantConfig?: string; createdAt?: string; }
interface Registration { tenantId: string; tenantRegistrationId: string; registrationStatus: string; }

export function TenantsPage() {
  const [tenants, setTenants] = useState<(Tenant & Partial<Registration>)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => navigate('/login'));
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [tRes, rRes] = await Promise.all([
          api('/tenants'),
          api('/tenant-registrations'),
        ]);
        if (cancelled) return;
        if (!tRes.ok) throw new Error('Error al obtener tenants: HTTP ' + tRes.status);
        const tBody = await tRes.json();
        const rBody = rRes.ok ? await rRes.json() : { data: [] };
        const tList: Tenant[] = tBody.data ?? tBody;
        const rList: Registration[] = rBody.data ?? rBody;
        setTenants(tList.map(t => {
          const reg = rList.find(r => r.tenantId === t.tenantId);
          return { ...t, ...reg };
        }));
        setError('');
      } catch (e: any) {
        if (!cancelled) setError('Error al cargar la lista de tenants: ' + (e.message ?? 'desconocido'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const timer = setInterval(async () => {
      try {
        const r = await api('/tenant-registrations');
        if (!r.ok) return;
        const rBody = await r.json();
        const rList: Registration[] = rBody.data ?? rBody;
        setTenants(prev => prev.map(t => {
          const reg = rList.find(rr => rr.tenantId === t.tenantId);
          return reg ? { ...t, ...reg } : t;
        }));
      } catch {}
    }, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user]);

  const handleDelete = async (tenantRegistrationId: string) => {
    if (!confirm('¿Eliminar este tenant? Su infraestructura será destruida.')) return;
    await api(`/tenant-registrations/${tenantRegistrationId}`, { method: 'DELETE' });
    setTenants(prev => prev.filter(t => t.tenantRegistrationId !== tenantRegistrationId));
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="font-semibold">Admin EHR SaaS</h1>
          <div className="flex items-center gap-3 text-sm">
            <span>{user.email}</span>
            <button onClick={handleLogout} className="text-slate-400 hover:text-white">Salir</button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <div><h2 className="text-2xl font-semibold">Tenants / Clínicas</h2></div>
          <Link to="/onboard" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Nuevo tenant</Link>
        </div>
        {error && <div className="mb-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 text-sm">{error}</div>}
        {loading ? <p className="text-slate-500">Cargando…</p> : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500"><tr>
                <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2">Subdominio</th><th className="px-4 py-2"></th>
              </tr></thead>
              <tbody className="divide-y">
                {tenants.map(t => {
                  const cfg = t.tenantConfig ? (() => { try { return JSON.parse(t.tenantConfig); } catch { return null; } })() : null;
                  const tierLabels: Record<string, string> = { core: 'Básico', professional: 'Profesional', enterprise: 'Empresarial' };
                  return (
                    <tr key={t.tenantId}>
                      <td className="px-4 py-3">{t.tenantName}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs">{tierLabels[t.tier] ?? t.tier}</span></td>
                      <td className="px-4 py-3">{t.registrationStatus === 'In progress' ? '⌛ En progreso' : t.registrationStatus === 'created' ? '✅ Activo' : t.registrationStatus ?? '—'}</td>
                      <td className="px-4 py-3">{cfg?.subdomain ? <a href={cfg.apiUrl ?? '#'} className="text-emerald-700">{cfg.subdomain}.pruebas.aws.gerardocastillo.me</a> : '—'}</td>
                      <td className="px-4 py-3 space-x-2">
                        <Link to={`/tenants/${t.tenantId}`} className="text-emerald-700">Gestionar</Link>
                        {t.tenantRegistrationId && (<button onClick={() => handleDelete(t.tenantRegistrationId!)} className="text-rose-600">Eliminar</button>)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tenants.length === 0 && <p className="p-4 text-slate-500 text-center">No hay tenants. Crea uno nuevo.</p>}
          </div>
        )}
      </main>
    </div>
  );
}