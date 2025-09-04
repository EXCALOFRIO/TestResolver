import { Question, QuestionMeta } from '../types';

/**
 * AVISO: Este parser heurístico ha sido DEPRECADADO. El flujo actual usa siempre
 * Gemini (structured output) para la extracción de preguntas. Se mantiene el
 * código por si en el futuro se desea un modo offline, pero no debe llamarse.
 */

interface OptionBlock {
  lines: string[];
  startIndex: number;
  endIndex: number;
}

/**
 * Parser Heurístico Estructural (v3.0 - Titanium).
 *
 * Este parser cambia el paradigma de "buscar pregunta -> buscar opciones" a
 * "buscar bloques de opciones -> inferir pregunta". Este enfoque "bottom-up"
 * es significativamente más resistente a formatos de cabecera de pregunta
 * ausentes, corruptos o inconsistentes.
 */
class StructuralQuestionParser {
  private text: string;
  private lines: string[];

  constructor(raw: string) {
    this.text = this.preProcess(raw);
    this.lines = this.text.split('\n');
  }

  private preProcess(t: string): string {
    return t
      .replace(/\r/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\t]+/g, ' ')
      .split('\n')
      .map(l => l.replace(/ +/g, ' ').trim())
      .filter(l => !this.isClearlyGarbage(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  private isClearlyGarbage(line: string): boolean {
    const garbagePatterns = [
      /^sociedad española de/i,
      /secretaria@semicyuc\.org/i,
      /www\.semicyuc\.org/i,
      /^\* versión \d+ del examen/i,
      /C\/ Alcalá, 290/i,
    ];
    return garbagePatterns.some(p => p.test(line));
  }

  public parse(): Question[] {
    // 1) Intento estándar basado en bloques de opciones
    const optionBlocks = this.findOptionBlocks();
    let questions: Question[] = [];
    if (optionBlocks.length) {
      let lastBlockEnd = -1;
      let id = 1;
      for (const block of optionBlocks) {
        const statementStartIndex = lastBlockEnd + 1;
        const statementEndIndex = block.startIndex;
        const statementLines = this.lines.slice(statementStartIndex, statementEndIndex);
        const statementText = statementLines.join(' ').trim();
        if (!statementText) continue;
        const { opciones } = this.parseOptionsFromBlock(block);
        if (Object.keys(opciones).length < 2) continue;
        let question = this.buildQuestion(id, statementText, opciones);
        question = this.enrichQuestion(question);
        questions.push(question);
        lastBlockEnd = block.endIndex;
        id++;
      }
    }

    // 2) Si no hubo resultados, intentar formato "Número X." con opciones separadas por líneas en blanco
    if (!questions.length) {
      const enumerated = this.parseEnumeratedNumberFormat();
      if (enumerated.length) questions = enumerated;
    }

    // 3) Si aún nada, salvamento total
    if (!questions.length) {
      questions = this.salvageEntireText();
    }

    try { (window as any).__parserDebug = { text: this.text, blocks: optionBlocks, questions }; } catch(_) {}
    return questions;
  }

  /**
   * Parser adicional para el formato:
   * "Número 29."\n
   * Enunciado (una o varias líneas) que termina normalmente en ':'
   * (línea en blanco)
   * Opción 1.
   * (línea en blanco)
   * Opción 2.
   * ... hasta la siguiente cabecera "Número N." o fin.
   */
  private parseEnumeratedNumberFormat(): Question[] {
    const headerRegex = /^n[úu]mero\s+\d+\./i;
    const headerIndexes: number[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      if (headerRegex.test(this.lines[i])) headerIndexes.push(i);
    }
    if (!headerIndexes.length) return [];

    const questions: Question[] = [];
    for (let h = 0; h < headerIndexes.length; h++) {
      const start = headerIndexes[h];
      const end = h + 1 < headerIndexes.length ? headerIndexes[h + 1] - 1 : this.lines.length - 1;
      const chunk = this.lines.slice(start, end + 1);
      if (chunk.length < 2) continue;
      // Quitar la línea de cabecera
      const body = chunk.slice(1);

      // Encontrar la última línea del enunciado: la primera que contenga ':' o, si no hay, la primera línea vacía.
      let enunciadoEndIdx = -1;
      for (let i = 0; i < body.length; i++) {
        if (body[i].includes(':')) { enunciadoEndIdx = i; break; }
      }
      if (enunciadoEndIdx === -1) {
        // fallback: hasta primera línea en blanco
        for (let i = 0; i < body.length; i++) { if (!body[i].trim()) { enunciadoEndIdx = i - 1; break; } }
        if (enunciadoEndIdx === -1) enunciadoEndIdx = Math.min(2, body.length - 1); // limitar
      }
      const statementLines = body.slice(0, enunciadoEndIdx + 1).filter(l => l.trim());
      const afterStatement = body.slice(enunciadoEndIdx + 1);
      if (!statementLines.length) continue;

      // Agrupar opciones por párrafos separados por al menos una línea en blanco
      const opciones: Record<string, string> = {};
      const paragraphs: string[] = [];
      let buffer: string[] = [];
      const flush = () => {
        if (buffer.length) {
          const text = buffer.join(' ').trim();
            if (text) paragraphs.push(text);
          buffer = [];
        }
      };
      for (const line of afterStatement) {
        if (!line.trim()) { flush(); continue; }
        // Si detectamos el inicio de otra pregunta antes de acabar de recolectar, abortamos este chunk.
        if (headerRegex.test(line)) { flush(); break; }
        buffer.push(line.trim());
      }
      flush();

      if (paragraphs.length >= 2 && paragraphs.length <= 12) {
        paragraphs.forEach((p, idx) => {
          const key = String.fromCharCode(65 + idx);
          // Limpiar posibles numeraciones residuales dentro de la opción
          const clean = p.replace(/^([a-jA-J]|\d{1,2})[\)\.:\-]\s*/, '').trim();
          opciones[key] = clean;
        });
      }
      if (Object.keys(opciones).length < 2) continue;
      const statement = statementLines.join(' ').trim().replace(/[:：]\s*$/,'');
      const q: Question = this.enrichQuestion(this.buildQuestion(questions.length + 1, statement, opciones));
      questions.push(q);
    }
    return questions;
  }
  
  /**
   * El corazón del nuevo parser. Itera sobre las líneas para identificar
   * grupos coherentes de opciones.
   */
  private findOptionBlocks(): OptionBlock[] {
    const blocks: OptionBlock[] = [];
    const optionPrefixRegex = /^\s*(?:([a-jA-J]|[1-9]|10)\s*[\)\.\-:]|([•*-]))\s+/;
    let currentBlock: string[] = [];
    let blockStartIndex = -1;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const isOptionStart = optionPrefixRegex.test(line);

      if (isOptionStart) {
        if (currentBlock.length === 0) {
          // Empezamos un nuevo bloque
          blockStartIndex = i;
        }
        currentBlock.push(line);
      } else {
        if (currentBlock.length > 0) {
          // No es un inicio de opción. ¿Es una continuación o el fin del bloque?
          const isContinuation = line.length > 0 && !/^(pregunta|número)/i.test(line);
          if (isContinuation) {
            currentBlock.push(line);
          } else {
            // Fin del bloque. Guardarlo si es válido.
            if (currentBlock.length >= 2) {
              blocks.push({ lines: currentBlock, startIndex: blockStartIndex, endIndex: i - 1 });
            }
            currentBlock = [];
            blockStartIndex = -1;
          }
        }
      }
    }
    // Guardar el último bloque si existe
    if (currentBlock.length >= 2) {
      blocks.push({ lines: currentBlock, startIndex: blockStartIndex, endIndex: this.lines.length - 1 });
    }
    return blocks;
  }
  
  /**
   * Parsea las líneas de un bloque de opciones ya identificado.
   * Maneja la concatenación de líneas (wrapping).
   */
  private parseOptionsFromBlock(block: OptionBlock): { opciones: Record<string, string> } {
    const opciones: Record<string, string> = {};
    const optionPrefixRegex = /^\s*(?:([a-jA-J]|[1-9]|10))\s*[\)\.\-:]\s*(.+)$/;
    const bulletPrefixRegex = /^\s*[•*-]\s*(.+)$/;
    let currentKey: string | null = null;
    let keyCounter = 0;

    for (const line of block.lines) {
      const match = line.match(optionPrefixRegex);
      const bulletMatch = line.match(bulletPrefixRegex);
      
      if (match) {
        currentKey = match[1].toUpperCase();
        opciones[currentKey] = match[2].trim();
      } else if (bulletMatch) {
        currentKey = String.fromCharCode(65 + keyCounter++);
        opciones[currentKey] = bulletMatch[1].trim();
      }
      else if (currentKey && line) {
        opciones[currentKey] += ' ' + line.trim();
      }
    }
    return { opciones };
  }

  private buildQuestion(id: number, statement: string, opciones: Record<string, string>): Question {
    // Limpieza final del enunciado para quitar cabeceras que se hayan colado.
    const cleanStatement = statement.replace(/^(pregunta|número|numero)\s+\d+[\.\):]?\s*/i, '').trim();

    return {
      id,
      pregunta: cleanStatement,
      opciones,
      meta: {}, // Los metadatos se añaden en la fase de enriquecimiento.
    };
  }

  /**
   * Analiza la pregunta ya construida para añadir metadatos contextuales.
   */
  private enrichQuestion(q: Question): Question {
    const meta: QuestionMeta = {};
    const statementLower = q.pregunta.toLowerCase();

    // Detección de negativa
    if (/\b(excepto|no|incorrecta|falsa)\b/i.test(statementLower)) {
      meta.negative = true;
    }
    
    // Detección de multi-respuesta
    if (/selecciona.*todas|todas.*apliquen|marque.*todas/.test(statementLower)) {
      meta.multi = true;
    }
    
    // Detección de Aserción-Razón
    if (/aserci[óo]n:.*raz[óo]n:/i.test(statementLower)) {
      meta.assertionReason = true;
    }

    // Detección estructural de emparejamiento
    const firstOptionValue = Object.values(q.opciones)[0] || '';
    if (/^\d+-[a-z],\s*\d+-[a-z]/i.test(firstOptionValue)) {
        meta.matching = true;
    } else if (/relaci[óo]n.*columnas|empareja|emparejamiento/.test(statementLower)) {
        meta.matching = true;
    }
    
    q.meta = meta;
    q.pregunta = this.addTagsToStatement(q.pregunta, meta);
    return q;
  }
  
  private addTagsToStatement(statement: string, meta: QuestionMeta): string {
    const tags: string[] = [];
    if (meta.negative) tags.push('[NEGATIVA]');
    if (meta.multi) tags.push('[MULTI]');
    if (meta.assertionReason) tags.push('[ASERCIÓN-RAZÓN]');
    if (meta.matching) tags.push('[RELACIÓN]');
    return tags.length ? `${tags.join(' ')} ${statement}` : statement;
  }
  
  /**
   * Si el método principal falla, este intenta un último parseo desesperado
   * asumiendo que el texto es UNA sola pregunta con opciones después del último '?'.
   */
  private salvageEntireText(): Question[] {
      const endOfStatement = Math.max(this.text.lastIndexOf('?'), this.text.lastIndexOf(':'));
      if (endOfStatement === -1) return [];

      const statement = this.text.slice(0, endOfStatement + 1).replace(/\n/g, ' ').trim();
      const optionsText = this.text.slice(endOfStatement + 1);

      const optionLines = optionsText.split('\n').map(l => l.trim()).filter(Boolean);
      if (optionLines.length < 2) return [];

      const opciones: Record<string, string> = {};
      optionLines.forEach((line, i) => {
          // Limpiar prefijos numéricos que puedan tener las opciones
          const cleanLine = line.replace(/^\s*([a-jA-J]|[1-9]|10)\s*[\)\.\-:]\s*/, '');
          opciones[String.fromCharCode(65 + i)] = cleanLine;
      });

      let question = this.buildQuestion(1, statement, opciones);
      question = this.enrichQuestion(question);
      return [question];
  }
}

// Función exportada que utiliza la nueva clase.
export function parseQuestionsHeuristically(raw: string): Question[] {
  const parser = new StructuralQuestionParser(raw);
  return parser.parse();
}
