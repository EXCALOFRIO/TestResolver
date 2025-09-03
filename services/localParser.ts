import { Question, QuestionMeta } from '../types';

/**
 * Parser heurístico avanzado capaz de manejar múltiples formatos de test:
 * - Prefijos: "Pregunta 1", "1.", "1)".
 * - Número variable de opciones (2..10) con letras a-j o 1..10.
 * - Opciones tipo Verdadero/Falso sin letra explícita.
 * - Preguntas multi‑respuesta (detecta frases: "selecciona todas", "todas las que apliquen").
 * - Formato negativo (EXCEPTO / NO / INCORRECTA) marcado en metadata.
 * - Aserción – Razón (Aserción:/Razón:) fusionadas en una sola pregunta.
 * - Emparejamiento (Relación de Columnas) colapsado a enunciado + opciones propuestas.
 */
export function parseQuestionsHeuristically(raw: string): Question[] {
  const text = normalizar(raw);
  const bloques = segmentarPreguntas(text);
  const questions: Question[] = [];
  let id = 1;
  for (const b of bloques) {
    let parsed = parseBloque(b, id);
    if (!parsed) {
      // Salvamento: intentar construir opciones tras la última '?'
      const salvage = salvageBloque(b, id);
      if (salvage) parsed = salvage;
    }
    if (parsed) { questions.push(parsed); id++; }
  }
  // Fallback final: si el texto contiene más numeraciones que las capturadas, intentar recuperar la última
  try {
    const nums = Array.from(text.matchAll(/(?:^|\n)\s*(?:pregunta\s+)?(\d+)[\.)]\s+/gi)).map(m=>parseInt(m[1],10));
    if (nums.length && nums.length > questions.length) {
      const missingStartNum = questions.length + 1; // asumimos consecutivo
      if (nums.includes(missingStartNum)) {
        // Obtener substring desde ese encabezado hasta el final (o siguiente encabezado)
        const pattern = new RegExp(`(?:^|\n)\s*(?:pregunta\s+)?${missingStartNum}[\.)]`,'i');
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
          const slice = text.slice(match.index);
          // cortar en siguiente encabezado
          const next = slice.slice(1).match(/\n\s*(?:pregunta\s+)?\d+[\.)]\s+/i);
          const bloque = next ? slice.slice(0, next.index + 1) : slice;
          const repaired = parseBloque(bloque.trim(), missingStartNum) || salvageBloque(bloque.trim(), missingStartNum);
          if (repaired) questions.push(repaired);
        }
      }
    }
  } catch(_) {}
  // Exponer debug (solo en navegador)
  try { (window as any).__parserDebug = { totalBloques: bloques.length, bloques, questions }; } catch(_) {}
  return questions;
}

// --- Normalización básica ---
function normalizar(t: string): string {
  return t
    .replace(/\r/g, '')
    .replace(/\u00A0/g,' ')
    .replace(/[\t]+/g,' ')
    .replace(/ +/g,' ') // colapsar espacios
    .replace(/\n{2,}/g,'\n\n')
    .trim();
}

// Divide por encabezados de pregunta
function segmentarPreguntas(t: string): string[] {
  // Aseguramos marcador antes de cada número plausible de pregunta
  const marker = '<<Q_SPLIT>>';
  const withMarks = t.replace(/(?:^|\n)\s*(?:pregunta\s+)?(\d+)[\.\)]\s+/gi, (m)=> `\n${marker}${m.trim()} `);
  return withMarks
    .split(marker)
    .map(s=>s.trim())
    .filter(s=>/(^pregunta\s+\d+|^\d+[\.\)])/.test(s));
}

interface ParsedOptions { opciones: Record<string,string>; meta: { multi?: boolean; negativo?: boolean; assertionReason?: boolean; matching?: boolean }; }

function parseBloque(bloque: string, id: number): Question | null {
  // Separar cabecera
  const headerMatch = bloque.match(/^(pregunta\s+\d+|\d+[\.\)])\s*/i);
  const header = headerMatch ? headerMatch[0] : '';
  let cuerpo = bloque.slice(header.length).trim();

  // Detectar aserción-razón y unificar línea
  if (/aserci[óo]n:/.test(cuerpo) && /raz[óo]n:/.test(cuerpo)) {
    cuerpo = cuerpo.replace(/(aserci[óo]n:\s*)/i,'Aserción: ').replace(/(raz[óo]n:\s*)/i,' Razón: ');
  }

  let { opciones, meta } = extraerOpciones(cuerpo);
  // Fallback extremo: si no se detectaron opciones, intentar derivar desde la última '?'
  if (Object.keys(opciones).length < 2) {
    const posQ = cuerpo.lastIndexOf('?');
    if (posQ !== -1 && posQ < cuerpo.length - 1) {
      const tail = cuerpo.slice(posQ + 1).trim();
      const cand = tail.split(/\n+/).map(l=>l.trim()).filter(Boolean);
      if (cand.length >= 2 && cand.length <= 10) {
        const tmp: Record<string,string> = {};
        cand.forEach((c,i)=> tmp[String.fromCharCode(65+i)] = c);
        opciones = tmp;
      }
    }
  }
  if (Object.keys(opciones).length < 2) return null;

  // Enunciado = cuerpo sin líneas de opciones
  const enunciado = limpiarEnunciado(cuerpo, opciones);
  const enriched = enriquecerEnunciado(enunciado, meta);
  const metaObj: QuestionMeta = {
    multi: meta.multi,
    negative: meta.negativo,
    assertionReason: meta.assertionReason,
    matching: meta.matching,
  };
  return { id, pregunta: enriched, opciones, meta: metaObj };
}

function extraerOpciones(cuerpo: string): ParsedOptions {
  const lineas = cuerpo.split(/\n+/).map(l=>l.trim()).filter(l=>l.length);
  const opciones: Record<string,string> = {};
  const meta: ParsedOptions['meta'] = {};

  // Heurísticas de tipo de pregunta
  const lower = cuerpo.toLowerCase();
  if (/selecciona.*todas|todas.*apliquen|marque.*todas/.test(lower)) meta.multi = true;
  // negativa solo se confirmará tras aislar el enunciado
  if (/aserci[óo]n:/.test(lower) && /raz[óo]n:/.test(lower)) meta.assertionReason = true;
  if (/relaci[óo]n.*columnas|empareja|emparejamiento/.test(lower)) meta.matching = true;

  // Patrones de opción con letra o número
  const regexOpcion = /^(?:([a-j])|([1-9]|10))\s*[\)\.-]\s*(.+)$/i;
  for (const ln of lineas) {
    const m = ln.match(regexOpcion);
    if (m) {
      const key = (m[1] || m[2])!.toUpperCase();
      const texto = m[3].trim();
      if (!opciones[key]) opciones[key] = texto;
    }
  }

  // Verdadero/Falso aislado
  if (Object.keys(opciones).length === 0) {
    const vf = lineas.filter(l=>/^(verdadero|falso|cierto|incorrecto|sí|si|no)$/i.test(l));
    if (vf.length >= 2 && vf.length <= 4) {
      const uniq = Array.from(new Set(vf.map(v=>v.toLowerCase())));
      uniq.forEach((t, idx)=> { opciones[String.fromCharCode(65+idx)] = capitalize(t); });
    }
  }

  // Fallback: opciones sin prefijo tras la última '?'
  if (Object.keys(opciones).length === 0) {
    const idxInterrogativa = lineas.reduce((acc, l, i)=> l.includes('?') ? i : acc, -1);
    if (idxInterrogativa >= 0 && idxInterrogativa < lineas.length - 1) {
      const posibles: string[] = [];
      for (let j = idxInterrogativa + 1; j < lineas.length; j++) {
        const ln = lineas[j];
        if (/^(pregunta\s+\d+|\d+[\.\)])$/i.test(ln)) break;
        if (!ln.trim()) break;
        posibles.push(ln.trim());
      }
      // Relajamos condiciones: aceptamos hasta 15 opciones y sin límite de longitud (algunos enunciados largos)
      if (posibles.length >= 2 && posibles.length <= 15) {
        posibles.forEach((p, idx)=> { opciones[String.fromCharCode(65+idx)] = p; });
      }
    }
  }

  // Fallback secundario: si todavía <2, intentar dividir por líneas consecutivas con punto final tras '?'
  if (Object.keys(opciones).length < 2) {
    const partes = cuerpo.split('?');
    if (partes.length > 1) {
      const tail = partes.slice(1).join('?').trim();
      const candidatos = tail.split(/\n+/).map(l=>l.trim()).filter(l=>l && !/^(pregunta\s+\d+|\d+[\.\)])$/i.test(l));
      if (candidatos.length >= 2) {
        candidatos.slice(0,10).forEach((p, idx)=> { if (!opciones[String.fromCharCode(65+idx)]) opciones[String.fromCharCode(65+idx)] = p; });
      }
    }
  }

  // Confirmar negativa usando solo el enunciado (hasta la última '?')
  const idxQ = cuerpo.lastIndexOf('?');
  const enunciadoSolo = idxQ !== -1 ? cuerpo.slice(0, idxQ + 1).toLowerCase() : lower;
  if (/excepto|\bno\b|incorrecta|falsa/.test(enunciadoSolo)) meta.negativo = true;

  return { opciones, meta };
}

function limpiarEnunciado(cuerpo: string, opciones: Record<string,string>): string {
  const lines = cuerpo.split(/\n+/);
  const keys = Object.keys(opciones);
  const pattern = new RegExp(`^(?:${keys.join('|')})[\)\.-]`,'i');
  const optionValues = new Set(Object.values(opciones));
  const filtered = lines.filter((l, idx)=> {
    const trimmed = l.trim();
    if (pattern.test(trimmed)) return false;
    if (optionValues.has(trimmed)) {
      const prevSection = lines.slice(0, idx+1).join('\n');
      const lastQ = prevSection.lastIndexOf('?');
      if (lastQ !== -1) return false;
    }
    return true;
  });
  return filtered.join(' ').replace(/\s+/g,' ').trim();
}

function enriquecerEnunciado(enunciado: string, meta: ParsedOptions['meta']): string {
  const tags: string[] = [];
  if (meta.multi) tags.push('[MULTI]');
  if (meta.assertionReason) tags.push('[ASERCIÓN-RAZÓN]');
  if (meta.matching) tags.push('[RELACIÓN]');
  return tags.length ? `${tags.join(' ')} ${enunciado}` : enunciado;
}
function capitalize(s: string){ return s.charAt(0).toUpperCase()+s.slice(1); }

// --- Salvamento extremo ---
function salvageBloque(bloque: string, id: number): Question | null {
  const headerMatch = bloque.match(/^(pregunta\s+\d+|\d+[\.\)])\s*/i);
  const header = headerMatch ? headerMatch[0] : '';
  const cuerpo = bloque.slice(header.length).trim();
  const qMarkIdx = cuerpo.lastIndexOf('?');
  if (qMarkIdx === -1) return null;
  const enunciado = cuerpo.slice(0, qMarkIdx + 1).trim();
  const tail = cuerpo.slice(qMarkIdx + 1).trim();
  if (!tail) return null;
  // Dividir por saltos de línea; si no hay, por puntos.
  let lines = tail.split(/\n+/).map(l=>l.trim()).filter(Boolean);
  if (lines.length < 2) {
    lines = tail.split(/(?<=\.)\s+/).map(l=>l.trim()).filter(Boolean);
  }
  if (lines.length < 2 || lines.length > 10) return null;
  const opciones: Record<string,string> = {};
  lines.forEach((ln, idx) => { opciones[String.fromCharCode(65+idx)] = ln; });
  return { id, pregunta: enunciado, opciones } as Question;
}