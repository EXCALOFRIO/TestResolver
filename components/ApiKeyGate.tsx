import React, { useEffect, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { validateGeminiKey } from '../services/keyUtils';

const API_DOC_URL = 'https://aistudio.google.com/app/u/1/apikey';

interface Props {
  onAuthenticated: (token?: string) => void;
  initialError?: string;
}

export const ApiKeyGate: React.FC<Props> = ({ onAuthenticated, initialError }) => {
  const [step, setStep] = useState<0 | 1 | 2>(0); // interno: 0 elegir, 1 auth, 2 api key (UI muestra 1,2,3)
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Evitar scroll del body mientras el modal está visible
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  const clearForms = () => {
    setEmail('');
    setPassword('');
    setApiKey('');
    setError(null);
  };

  // Helper fetch
  async function postJson(path: string, body?: unknown, auth?: string) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw json;
    return json as any;
  }

  const friendlyError = (raw: any): string => {
    const code = String(raw?.error || raw?.code || raw?.message || '').toUpperCase();
    switch (code) {
      case 'KEY_ALREADY_EXISTS':
        return 'Esta clave ya está en uso.';
      case 'EMAIL_EXISTS':
        return 'No se pudo completar. Prueba con otro correo o inicia sesión.';
      case 'INVALID_CREDENTIALS':
        return 'Datos no válidos.';
      case 'UNAUTHENTICATED':
      case 'INVALID_TOKEN':
        return 'Sesión no válida. Vuelve a entrar.';
      case 'MISSING_FIELDS':
        return 'Completa todos los campos.';
      default:
        return 'Ha ocurrido un error. Inténtalo de nuevo.';
    }
  };

  const doAuth = async () => {
    if (!mode) { setError('Selecciona iniciar sesión o crear cuenta'); return; }
    setError(null);
    setLoading(true);
    try {
      const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const { token, user } = await postJson(path, { email, password });
      if (!token) throw new Error('Sin token');
  localStorage.setItem('authToken', token);
  localStorage.setItem('authEmail', (user?.email || email || '').toString());
      // Intentar recuperar claves del backend y validar
      try {
        // Cargar claves propias
        const res = await fetch('/api/apikey', { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
        const ownData = res.ok ? await res.json().catch(()=>({})) : {};
        const ownKeys: Array<{id:number, api_key:string}> = Array.isArray(ownData?.keys) ? ownData.keys : [];
        const validCollected: Array<{id?:number, api_key:string}> = [];
        for (const entry of ownKeys) {
          const k = entry.api_key;
          if (await validateGeminiKey(k)) {
            validCollected.push({ id: entry.id, api_key: k });
            console.info('[ApiKeyGate] Clave de usuario válida desde DB id=', entry.id);
          }
        }
        if (validCollected.length) {
          const current = JSON.parse(localStorage.getItem('userKeys') || '[]');
          // Guardamos array de objetos {id?, api_key}
          const merged = Array.isArray(current) ? (current.concat(validCollected)) : validCollected;
          // Deduplicar por api_key
          const seen = new Map<string, any>();
          for (const it of merged) { if (!seen.has(it.api_key)) seen.set(it.api_key, it); }
          const updated = Array.from(seen.values());
          localStorage.setItem('userKeys', JSON.stringify(updated));
          onAuthenticated(token);
          setLoading(false);
          return;
        }
      } catch {}
  setStep(2);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  async function validateKey(key: string) { return validateGeminiKey(key); }

  const saveKey = async () => {
    setError(null);
    setLoading(true);
    const token = localStorage.getItem('authToken') || '';
    if (!token) {
      setStep(1);
      setLoading(false);
      return;
    }
    try {
      const key = apiKey.trim();
      const isValid = await validateKey(key);
      if (!isValid) {
        setError('API Key inválida o sin permisos.');
        setLoading(false);
        return;
      }
      await postJson('/api/apikey', { apiKey: key }, token);
      // Persistir también en localStorage para rotación en cliente
      const current = JSON.parse(localStorage.getItem('userKeys') || '[]');
      const updated = Array.from(new Set([key, ...(Array.isArray(current) ? current : [])]));
      localStorage.setItem('userKeys', JSON.stringify(updated));
      onAuthenticated(token);
    } catch (e: any) {
      // Mostrar mensaje más específico si el backend indica que la clave ya existe
      if (e && (e.error === 'KEY_ALREADY_EXISTS' || String(e?.error || '').toUpperCase() === 'KEY_ALREADY_EXISTS')) {
        setError('La clave ya está registrada y no puede volver a guardarse.');
      } else {
        setError('No se pudo guardar la clave.');
      }
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setStep(0);
    setMode(null);
    clearForms();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3">
      <div className="w-full max-w-lg rounded-2xl overflow-hidden bg-slate-900 text-slate-100 border border-slate-700 shadow-xl">
        {/* Header con progreso */}
        <div className="relative bg-gradient-to-r from-indigo-600/20 to-purple-600/20 px-6 py-4 border-b border-slate-700/50">
          <div className="absolute top-3 right-3">
            {step === 2 && (
              <button onClick={logout} className="px-3 py-1.5 text-xs rounded-lg bg-slate-800/80 border border-slate-600/50 hover:bg-slate-700/80 transition-colors">
                Cerrar sesión
              </button>
            )}
          </div>
          <h1 className="text-2xl font-bold mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            Bienvenido a TestSolver
          </h1>
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= 0 ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>1</div>
            <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-indigo-600' : 'bg-slate-700'}`}></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>2</div>
            <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-indigo-600' : 'bg-slate-700'}`}></div>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'}`}>3</div>
          </div>
          {step !== 0 && (
            <p className="text-slate-300 text-sm">
              {step === 1 ? (mode === 'register' ? 'Crea tu cuenta' : 'Inicia sesión') : 'Configura tu API Key'}
            </p>
          )}
        </div>

        {/* Contenido */}
        <div className="p-6 space-y-5">
          {step === 0 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-slate-400 text-sm">¿Tienes cuenta o quieres crear una nueva?</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => { setMode('register'); setStep(1); setError(null); }}
                  className="py-4 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 font-semibold"
                >
                  Crear cuenta
                </button>
                <button
                  onClick={() => { setMode('login'); setStep(1); setError(null); }}
                  className="py-4 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-slate-600/50 font-semibold"
                >
                  Iniciar sesión
                </button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-slate-400 text-sm">{mode === 'register' ? 'Introduce tu email y una contraseña para registrarte' : 'Introduce tus credenciales para continuar'}</p>
              </div>

              <div className="space-y-3">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className="w-full px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-600/50 outline-none focus:border-indigo-500/50 focus:bg-slate-800/80 transition-all"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="Contraseña"
                  className="w-full px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-600/50 outline-none focus:border-indigo-500/50 focus:bg-slate-800/80 transition-all"
                />

                <button
                  disabled={loading || !email.trim() || !password.trim()}
                  onClick={doAuth}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? 'Procesando...' : mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}
                </button>

                <div className="flex items-center justify-between text-sm text-slate-400">
                  <button onClick={() => { setStep(0); clearForms(); }} className="hover:text-slate-200">Volver</button>
                  <button onClick={() => setMode(mode === 'register' ? 'login' : 'register')} className="hover:text-slate-200">
                    {mode === 'register' ? 'Iniciar sesión' : 'Crear cuenta'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <p className="text-slate-400 text-sm">Necesitas tu propia clave de Google Gemini para usar la aplicación</p>
              </div>

              <div className="bg-slate-800/30 rounded-xl p-4 mb-2">
                <h4 className="font-semibold text-sm mb-3 text-indigo-400">Cómo obtener tu API Key:</h4>
                <ol className="list-decimal ml-4 space-y-1.5 text-xs text-slate-300">
                  <li>Haz clic en el botón de abajo para abrir Google AI Studio</li>
                  <li>Inicia sesión con tu cuenta de Google</li>
                  <li>Haz clic en "Create API key"</li>
                  <li>Copia la clave generada y pégala aquí</li>
                </ol>

                <a
                  className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
                  href={API_DOC_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Abrir Google AI Studio
                </a>
              </div>

              <div className="space-y-3">
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Pega aquí tu API Key (ej: AIzaSy...)"
                  className="w-full px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-600/50 outline-none focus:border-green-500/50 focus:bg-slate-800/80 transition-all font-mono text-sm"
                />

                <button
                  disabled={loading || !apiKey.trim()}
                  onClick={saveKey}
                  className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? 'Verificando clave...' : 'Verificar y guardar'}
                </button>

                <div className="text-xs text-slate-400 text-center">Tu clave se guarda cifrada en el servidor y localmente para rotación.</div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-2 p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-300 text-sm">
              {String(error)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

