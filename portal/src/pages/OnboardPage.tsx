import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../main';

const TIERS = [
  { value: 'core', label: 'Básico (Core)' },
  { value: 'professional', label: 'Profesional (Centro Médico)' },
  { value: 'enterprise', label: 'Empresarial (Hospital / Red)' },
];

export function OnboardPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState('core');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await api('/tenant-registrations', {
      method: 'POST',
      body: JSON.stringify({
        tenantData: { tenantName: name, email, tier },
        tenantRegistrationData: { registrationStatus: 'In progress' },
      }),
    });
    navigate('/');
  };

  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white"><div className="max-w-3xl mx-auto px-4 h-14 flex items-center"><Link to="/" className="text-slate-300 hover:text-white text-sm">← Volver</Link></div></header>
      <main className="max-w-xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-semibold mb-6">Nuevo tenant</h2>
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-6 space-y-4">
          <label className="block"><span className="text-sm font-medium">Nombre de la clínica</span><input required value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" /></label>
          <label className="block"><span className="text-sm font-medium">Email del administrador</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm" /></label>
          <label className="block"><span className="text-sm font-medium">Plan</span>
            <select value={tier} onChange={e => setTier(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-2 text-sm">
              {TIERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Link to="/" className="rounded-md border px-3 py-2 text-sm">Cancelar</Link>
            <button disabled={submitting} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {submitting ? 'Creando…' : 'Crear tenant'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}