import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

// Cargar .env.local
if (fs.existsSync('.env.local')) {
    dotenv.config({ path: '.env.local' });
    console.log('✅ Cargado .env.local');
} else {
    dotenv.config();
    console.log('ℹ️ .env.local no encontrado, usando .env por defecto');
}

const keys = Object.keys(process.env)
    .filter(k => /^GEMINI_API_KEY\d*$/.test(k) || k === 'API_KEY')
    .map(k => ({ name: k, value: process.env[k] }))
    .filter(o => o.value && o.value.trim() !== '');

if (keys.length === 0) {
    console.error('❌ No se encontraron claves GEMINI_API_KEY en el entorno.');
    process.exit(1);
}

console.log(`🔍 Encontradas ${keys.length} claves. Empezando test...\n`);

async function testKey(keyObj) {
    const { name, value } = keyObj;
    const client = new GoogleGenAI({ apiKey: value });
    // Usamos un modelo ligero para el ping
    const modelName = 'gemini-2.5-flash-lite';

    try {
        const payload = {
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: 'hi' }] }]
        };
        const resp = await client.models.generateContent(payload);
        const text = typeof resp.text === 'function' ? resp.text() : resp.text;

        return {
            name,
            status: '✅ FUNCIONA',
            tail: `...${value.slice(-6)}`,
            error: null
        };
    } catch (error) {
        return {
            name,
            status: '❌ FALLA',
            tail: `...${value.slice(-6)}`,
            error: error.message || 'Error desconocido'
        };
    }
}

async function runTests() {
    const results = [];
    for (const k of keys) {
        process.stdout.write(`Probando ${k.name} `);
        const res = await testKey(k);
        console.log(res.status);
        results.push(res);
    }

    console.log('\n=== RESUMEN DE RESULTADOS ===');
    results.forEach(r => {
        if (r.error) {
            console.log(`${r.name} (${r.tail}): ${r.status} -> Motivo: ${r.error}`);
        } else {
            console.log(`${r.name} (${r.tail}): ${r.status}`);
        }
    });
}

runTests();
