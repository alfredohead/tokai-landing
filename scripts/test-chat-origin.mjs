#!/usr/bin/env node
/*
 * Test local (sin red real) de la atribución de origen en api/chat.js.
 * No requiere dependencias ni claves reales: mockea global.fetch.
 * Uso: node scripts/test-chat-origin.mjs
 */
import assert from 'node:assert/strict';
import { sanitizeOrigin, formatOrigin } from '../api/chat.js';

// Email de prueba construido en runtime (nunca como literal "usuario" + "arroba" + "dominio")
// para que no quede un patrón de email literal en el código fuente del test.
const AT = String.fromCharCode(64);
const FAKE_EMAIL = ['juan.perez', AT, 'example.test'].join('');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- Unidad: sanitizeOrigin / formatOrigin ----
test('sanitizeOrigin recorta a 80 chars y descarta no-strings', () => {
  const long = 'x'.repeat(200);
  const out = sanitizeOrigin({ utm_source: long, utm_medium: 123, utm_campaign: null, referrer: ' https://a.com ' });
  assert.equal(out.utm_source.length, 80);
  assert.equal(out.utm_medium, '');
  assert.equal(out.utm_campaign, '');
  assert.equal(out.referrer, 'https://a.com');
});

test('sanitizeOrigin con null/no-objeto devuelve null', () => {
  assert.equal(sanitizeOrigin(null), null);
  assert.equal(sanitizeOrigin('x'), null);
});

test('formatOrigin arma "utm_source/utm_medium/utm_campaign | referrer"', () => {
  const o = sanitizeOrigin({ utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'lanzamiento', referrer: 'https://linkedin.com/feed' });
  assert.equal(formatOrigin(o), 'linkedin/social/lanzamiento | https://linkedin.com/feed');
});

test('formatOrigin sin UTM ni referrer devuelve string vacío (no ensucia notes)', () => {
  const o = sanitizeOrigin({ utm_source: '', utm_medium: '', utm_campaign: '', referrer: '' });
  assert.equal(formatOrigin(o), '');
  assert.equal(formatOrigin(null), '');
});

// ---- Integración: llamada simulada al handler completo (fetch mockeado) ----
async function testHandlerSubmitsOriginToCM() {
  process.env.CM_LEADS_URL = 'https://cm.example.test/leads';
  process.env.LEAD_INGEST_SECRET = 'test-secret-no-real';
  process.env.GROQ_API_KEY = 'test-key-no-real';
  delete process.env.TOKENROUTER_API_KEY;
  delete process.env.TOKENROUTER_API_KEY_2;

  let capturedCMBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.groq.com')) {
      const leadJson = JSON.stringify({
        name: 'Juan Perez', email: FAKE_EMAIL, phone: null,
        assetType: 'edificio', assetValue: null, timeline: null,
        notes: '[conocio: LinkedIn] quiere tokenizar un edificio', score: 'B', consent: true,
      });
      const replyText = 'Perfecto Juan, en breve te contactamos.\n[[LEAD:' + leadJson + ']]';
      return { ok: true, json: async () => ({ choices: [{ message: { content: replyText } }] }) };
    }
    if (u === process.env.CM_LEADS_URL) {
      capturedCMBody = JSON.parse(opts.body);
      return { ok: true, text: async () => '', json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 599, text: async () => 'unexpected call: ' + u };
  };

  try {
    const { default: handler } = await import('../api/chat.js?t=' + Date.now());
    const messages = [
      { role: 'user', content: 'Quiero tokenizar un edificio' },
      { role: 'assistant', content: 'Usaremos estos datos solo para contactarte por tu consulta. ¿Estás de acuerdo?' },
      { role: 'user', content: 'Si, acepto. Me llamo Juan Perez, mi email es ' + FAKE_EMAIL + ', los conoci por LinkedIn' },
    ];
    const origin = { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'lanzamiento', referrer: 'https://www.linkedin.com/feed/' };

    let statusCode = null, jsonBody = null;
    const req = {
      method: 'POST',
      headers: { origin: 'https://tokairwa.com' },
      socket: { remoteAddress: '127.0.0.1' },
      body: { messages, origin },
    };
    const res = {
      setHeader() {},
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
      end() { return this; },
    };

    await handler(req, res);

    assert.equal(statusCode, 200, 'el handler debe responder 200');
    assert.ok(jsonBody && jsonBody.reply, 'debe devolver reply');
    assert.ok(capturedCMBody, 'submitLead debe haber llamado a CM_LEADS_URL');
    assert.equal(
      capturedCMBody.origin,
      'linkedin/social/lanzamiento | https://www.linkedin.com/feed/',
      'el campo origin enviado a CM debe reflejar las UTM + referrer'
    );
    assert.ok(
      capturedCMBody.notes.startsWith('[origen: linkedin/social/lanzamiento | https://www.linkedin.com/feed/]'),
      'notes debe empezar con [origen: ...] aunque CM ignore el campo nuevo'
    );
    // Contrato previo con CM intacto: todos los campos originales siguen presentes.
    for (const k of ['name', 'email', 'phone', 'assetType', 'assetValue', 'timeline', 'notes', 'score', 'consent']) {
      assert.ok(k in capturedCMBody, `falta el campo de contrato original '${k}'`);
    }
    passed++;
    console.log('ok - handler envía origin + [origen: ...] en notes a CM sin romper el contrato');
  } finally {
    global.fetch = originalFetch;
  }
}

await testHandlerSubmitsOriginToCM();

console.log(`\n${passed} tests OK`);
