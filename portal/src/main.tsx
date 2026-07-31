import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TenantsPage } from './pages/TenantsPage';
import { OnboardPage } from './pages/OnboardPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { LoginPage } from './pages/LoginPage';
import './index.css';

let controlPlaneApiUrl = '';
let featureApiUrl = '';

async function init() {
  try {
    const res = await fetch('/config.json');
    if (!res.ok) throw new Error('config.json not found');
    const cfg = await res.json();
    controlPlaneApiUrl = cfg.controlPlaneApiUrl.replace(/\/+$/, '');
    featureApiUrl = cfg.featureApiUrl.replace(/\/+$/, '');
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: cfg.userPoolId,
          userPoolClientId: cfg.userPoolClientId,
          loginWith: {
            oauth: {
              domain: cfg.cognitoDomain,
              scopes: ['openid', 'email', 'profile'],
              redirectSignIn: [window.location.origin + '/'],
              redirectSignOut: [window.location.origin + '/login'],
              responseType: 'code',
            },
          },
        },
      },
    });
  } catch (e) {
    document.getElementById('root')!.innerHTML =
      '<p style="padding:2rem;color:#dc2626">Error al cargar la configuracion del portal. Verifica que <code>write-portal-config.sh</code> se haya ejecutado.</p>';
    return;
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

export async function api(path: string, init?: RequestInit) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString() ?? '';
  return fetch(`${controlPlaneApiUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

export async function callFeatureApi(path: string, init?: RequestInit) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString() ?? '';
  return fetch(`${featureApiUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<TenantsPage />} />
        <Route path="/onboard" element={<OnboardPage />} />
        <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

init();