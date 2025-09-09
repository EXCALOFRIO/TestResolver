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
  const parsed = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  // parsed puede ser array de strings (legacy) o array de objetos {id?, api_key}
  let firstKey: string | undefined;
  for (const v of parsed) {
    if (!v) continue;
    if (typeof v === 'string' && v.trim()) { firstKey = v.trim(); break; }
    if (typeof v === 'object' && typeof v.api_key === 'string' && v.api_key.trim()) { firstKey = v.api_key.trim(); break; }
  }
  if (!firstKey) return false;
  // Validar SOLO la primera clave para evitar múltiples peticiones
  return await validateGeminiKey(firstKey);
  } catch {
    return false;
  }
}
