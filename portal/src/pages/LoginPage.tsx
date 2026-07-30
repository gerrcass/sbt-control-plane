import { signInWithRedirect, getCurrentUser, signOut } from 'aws-amplify/auth';
import { useEffect, useState } from 'react';

export function LoginPage() {
  const [checking, setChecking] = useState(true);
  useEffect(() => { getCurrentUser().then(() => window.location.href = '/').catch(() => setChecking(false)); }, []);

  if (checking) return <div className="p-8 text-center text-slate-500">Verificando sesi&oacute;n…</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="bg-white rounded-xl shadow-xl p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-4">⚕</div>
        <h1 className="text-xl font-semibold text-slate-900">Admin EHR SaaS</h1>
        <p className="text-sm text-slate-500 mt-2">Portal de administraci&oacute;n multi-tenant</p>
        <button
          onClick={() => signInWithRedirect()}
          className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Ingresar con Cognito
        </button>
      </div>
    </div>
  );
}