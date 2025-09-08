import { GoogleGenAI } from '@google/genai';

export async function validateGeminiKey(key: string): Promise<boolean> {
  const k = (key || '').trim();
  if (!k) return false;
  try {
    const client = new GoogleGenAI({ apiKey: k });
  // Usar un modelo rápido y ligero solo para verificación de validez de clave
  const resp: any = await client.models.generateContent({ model: 'models/gemma-3n-e2b-it', contents: 'ping' });
    return Boolean(resp && (resp.text || (Array.isArray((resp as any).candidates) && (resp as any).candidates.length)));
  } catch {
    return false;
  }
}

export async function validateAnyStoredUserKey(): Promise<boolean> {
  try {
  const raw = localStorage.getItem('userKeys') || '[]';
  const arr = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  const first: string | undefined = arr.find((v: any) => typeof v === 'string' && v.trim());
  if (!first) return false;
  // Validar SOLO la primera clave para evitar múltiples peticiones
  return await validateGeminiKey(first);
  } catch {
    return false;
  }
}
