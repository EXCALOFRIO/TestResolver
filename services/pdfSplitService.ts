/**
 * pdfSplitService.ts
 * 
 * Servicio para pre-análisis y división inteligente de PDFs.
 * Usa "anclas de texto" en vez de posiciones numéricas para evitar alucinaciones.
 */

import { PDFDocument } from 'pdf-lib';

// ========== TIPOS ==========

// ========== TIPOS GLOBALES ==========

export interface GlobalWorkChunk {
    /** Identificador del archivo */
    f: string;
    /** Rango de preguntas [inicio, fin] */
    r: [number, number];
    /** Páginas físicas */
    p: number[];
    /** Descripción opcional */
    d?: string;
}

export interface GlobalAnalysisResult {
    /** Título sugerido */
    t?: string;
    /** Chunks */
    c: GlobalWorkChunk[];
}

export const globalPreAnalysisSchema = {
    type: 'OBJECT',
    properties: {
        t: { type: 'STRING', description: 'Título sugerido del examen (máx 5 palabras)' },
        c: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    f: { type: 'STRING', description: 'Nombre o ID del archivo' },
                    r: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[desde, hasta] número de preguntas' },
                    p: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Páginas físicas (1-based) para este chunk' },
                    d: { type: 'STRING', description: 'Opcional: descripción de imagen si el archivo es imagen o chunk visual' }
                },
                required: ['f', 'r', 'p']
            }
        }
    },
    required: ['c']
};

export const GLOBAL_PRE_ANALYSIS_PROMPT = `ANÁLISIS ESTRATÉGICO DE EXTRACCIÓN GLOBAL

Se te proporcionan múltiples archivos (PDFs, imágenes) y texto. Tu objetivo es crear un MAPA DE TRABAJO para extraer (~50 preguntas por unidad).

REGLAS:
1. Divide el trabajo en "chunks" de máximo 50 preguntas.
2. Para cada chunk, identifica:
   - "f": El nombre exacto del archivo que contiene las preguntas.
   - "r": El rango de preguntas (ej. [1, 50], [51, 100]).
   - "p": Las PÁGINAS exactas (1, 2, 3...) del PDF que necesitamos para ese rango (incluye páginas de anexos/figuras si la pregunta las referencia).
3. Si el archivo es una IMAGEN, el rango de páginas será [1] y puedes usar "d" para describir lo que se ve.

Devuelve un JSON compacto siguiendo el schema proporcionado.
Ejemplo: {"t":"Examen de Biología","c":[{"f":"tema1.pdf","r":[1,50],"p":[1,2,3,4,15,16]},{"f":"img_celula.jpg","r":[51,51],"p":[1],"d":"Diagrama mitocondria"}]}`;

// ========== FUNCIONES DE DIVISIÓN FÍSICA ==========

/**
 * Crea una versión reducida de un PDF que solo contiene las páginas solicitadas.
 * Ideal para enviar como inlineData (ahorra tokens y evita File API).
 */
export async function slicePdf(
    pdfBytes: Uint8Array,
    pageNumbers: number[]
): Promise<Uint8Array> {
    if (!pageNumbers?.length) return pdfBytes;

    try {
        const srcDoc = await PDFDocument.load(pdfBytes);
        const newDoc = await PDFDocument.create();

        // Normalizar y filtrar índices
        const totalPages = srcDoc.getPageCount();
        const indices = [...new Set(pageNumbers)]
            .map(p => p - 1)
            .filter(i => i >= 0 && i < totalPages)
            .sort((a, b) => a - b);

        if (indices.length === 0) return pdfBytes;

        const copiedPages = await newDoc.copyPages(srcDoc, indices);
        copiedPages.forEach(p => newDoc.addPage(p));

        return await newDoc.save();
    } catch (e) {
        console.error('[slicePdf] Error cortando PDF:', e);
        return pdfBytes; // Fallback al original
    }
}

/**
 * Obtiene el número de páginas de un PDF.
 */
export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
    try {
        const doc = await PDFDocument.load(pdfBytes);
        return doc.getPageCount();
    } catch {
        return 0;
    }
}

