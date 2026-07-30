import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { TenantsPage } from './pages/TenantsPage';
import { OnboardPage } from './pages/OnboardPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { LoginPage } from './pages/LoginPage';
import './index.css';

let apiUrl = '';
let featureApiUrl = '';

async function init() {
  const res = await fetch('/config.json');
  if (!res.ok) {
    document.getElementById('root')!.innerHTML = '<p style="padding:2rem">Portal de administración — <code>config.json</code> no encontrado. Ejecuta <code>scripts/write-portal-config.sh</code>.</p>';
    return;
  }
  const cfg = await res.json();
  apiUrl = cfg.controlPlaneApiUrl;
  featureApiUrl = cfg.featureApiUrl;
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
            redirectSignOut: [window.location.origin + '/'],
            responseType: 'code',
          },
        },
      },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

export async function api(path: string, init?: RequestInit) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString() ?? '';
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

export async function featureApi(path: string, init?: RequestInit) {
  return api(path, init); // Same JWT authorizer, different URL base
}

// Use featureApiUrl directly for this
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