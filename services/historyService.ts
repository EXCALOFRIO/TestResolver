import { Question, ResultsState, TestRunSummary, TestRunDetail } from '../types';

const base = '/api';

function authHeaders(){
  const token = localStorage.getItem('authToken');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function saveTestRun(params: { name?: string; questions: Question[]; results: ResultsState }): Promise<TestRunSummary | null> {
  try {
    const r = await fetch(`${base}/tests`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', ...authHeaders() },
      body: JSON.stringify({ name: params.name, questions: params.questions, results: params.results })
    });
    if (!r.ok) return null;
    const data = await r.json();
  return data.run as TestRunSummary;
  } catch { return null; }
}

export async function listTestRuns(limit=20, offset=0): Promise<TestRunSummary[]> {
  try {
    const r = await fetch(`${base}/tests?limit=${limit}&offset=${offset}`, { headers: { ...authHeaders() } });
    if (!r.ok) return [];
    const data = await r.json();
    return data.runs as TestRunSummary[];
  } catch { return []; }
}

export async function getTestRun(id: number): Promise<TestRunDetail | null> {
  try {
    const r = await fetch(`${base}/tests/${id}`, { headers: { ...authHeaders() } });
    if (!r.ok) return null;
    const data = await r.json();
    return data.run as TestRunDetail;
  } catch { return null; }
}

export async function renameTestRun(id: number, name: string): Promise<TestRunSummary | null> {
  try {
    const r = await fetch(`${base}/tests/${id}`, { method: 'PATCH', headers: { 'Content-Type':'application/json', ...authHeaders() }, body: JSON.stringify({ name }) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.run as TestRunSummary;
  } catch { return null; }
}

export async function shareTestRun(id: number): Promise<{ token: string; url: string } | null> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const r = await fetch(`${base}/tests/${id}/share`, { method: 'POST', headers: { 'X-Client-Origin': origin, ...authHeaders() } });
    if (!r.ok) return null;
    const data = await r.json();
    let url = data.url as string;
    // Forzar a usar el origin real del front si difiere (evitar puerto backend en dev)
    if (origin && url) {
      try {
        const u = new URL(url);
        const front = new URL(origin);
        if (u.host !== front.host) {
          url = `${front.protocol}//${front.host}/t/${data.token}`;
        }
      } catch {}
    }
    return { token: data.token, url };
  } catch { return null; }
}

export async function deleteTestRun(id: number): Promise<boolean> {
  try {
    const r = await fetch(`${base}/tests/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
    return r.ok;
  } catch { return false; }
}
