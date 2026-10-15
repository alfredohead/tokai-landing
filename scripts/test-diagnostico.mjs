#!/usr/bin/env node
/*
 * Test local (sin red real) del endpoint del formulario /diagnostico/.
 * Mockea global.fetch: no requiere dependencias ni claves reales.
 * Uso: node scripts/test-diagnostico.mjs
 */
import assert from 'node:assert/strict';

// Email de prueba armado en runtime para no dejar un patrón de email literal en el fuente.
const AT = String.fromCharCode(64);
const FAKE_EMAIL = ['emisor', AT, 'example.test'].join('');

process.env.CM_LEADS_URL = 'https://cm.example.test/leads';
process.env.LEAD_INGEST_SECRET = 'test-secret-no-real';

let passed = 0;
function ok(name) { passed++; console.log('ok - ' + name); }

const cmCalls = [];
const originalFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url) === process.env.CM_LEADS_URL) {
    cmCalls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return { ok: globalThis.__cmDown ? false : true, status: globalThis.__cmDown ? 500 : 200, json: async () => ({ ok: true }) };
  }
  return { ok: false, status: 599, json: async () => ({ error: 'llamada inesperada: ' + url }) };
};

const { default: handler } = await import('../api/diagnostico.js?t=' + Date.now());

function fakeRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

async function post(payload, ip) {
  const res = fakeRes();
  await handler({
    method: 'POST',
    headers: { origin: 'https://tokairwa.com', 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    body: payload,
  }, res);
  return res;
}

const valid = {
  name: 'Ana Gomez',
  email: FAKE_EMAIL,
  phone: '+54 9 261 555 1234',
  assetType: 'inmobiliario',
  assetValue: '2m-10m',
  timeline: '6-12',
  notes: 'Edificio en alquiler, quiero ampliar la base de inversores.',
  consent: true,
  website: '',
  origin: { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'diagnostico', referrer: 'https://www.linkedin.com/feed/' },
};

// 1. Envío válido: reenvía a CM con etiquetas legibles, origen y puntaje.
{
  cmCalls.length = 0;
  const res = await post(valid, '10.0.0.1');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(cmCalls.length, 1, 'debe llamar una vez a CM_LEADS_URL');
  const sent = cmCalls[0].body;
  assert.equal(cmCalls[0].headers['x-lead-secret'], 'test-secret-no-real');
  assert.equal(sent.assetType, 'Inmobiliario (terreno, edificio, desarrollo, renta)');
  assert.equal(sent.assetValue, 'USD 2.000.000 - 10.000.000');
  assert.equal(sent.timeline, 'Entre 6 y 12 meses');
  assert.equal(sent.score, 'A', 'valor alto + plazo <12 meses = A');
  assert.equal(sent.consent, true);
  assert.ok(sent.notes.startsWith('[origen: diagnostico] linkedin/social/diagnostico | https://www.linkedin.com/feed/'),
    'notes debe empezar con [origen: diagnostico] + UTM/referrer');
  assert.ok(sent.notes.includes('Edificio en alquiler'));
  for (const k of ['name', 'email', 'phone', 'assetType', 'assetValue', 'timeline', 'notes', 'score', 'consent']) {
    assert.ok(k in sent, `falta el campo de contrato de CM '${k}'`);
  }
  assert.ok(!('source' in sent), 'no se manda source (CM lo fija en chatbot): el origen va en notes');
  ok('envío válido -> 200 y reenvío a CM con [origen: diagnostico] + UTM, etiquetas legibles y score A');
}

// 2. Sin consentimiento: 422 y nada se guarda.
{
  cmCalls.length = 0;
  const res = await post({ ...valid, consent: false }, '10.0.0.2');
  assert.equal(res.statusCode, 422);
  assert.equal(cmCalls.length, 0, 'sin consentimiento no se llama a CM');
  ok('sin consentimiento -> 422 y no se guarda nada');
}

// 3. Datos inválidos: 400 sin llamar a CM.
{
  cmCalls.length = 0;
  const bad = [
    [{ ...valid, name: 'A' }, 'nombre demasiado corto'],
    [{ ...valid, email: 'no-es-mail' }, 'mail inválido'],
    [{ ...valid, assetType: 'otro-inventado' }, 'tipo de activo fuera del catálogo'],
    [{ ...valid, assetValue: '99m' }, 'valor fuera del catálogo'],
    [{ ...valid, timeline: 'x' }, 'plazo fuera del catálogo'],
    [{ ...valid, phone: '123' }, 'teléfono inválido'],
  ];
  for (const [i, [payload, label]] of bad.entries()) {
    const res = await post(payload, '10.0.0.' + (30 + i));
    assert.equal(res.statusCode, 400, label + ' debe dar 400');
    assert.ok(res.body.error, label + ' debe devolver mensaje de error');
  }
  assert.equal(cmCalls.length, 0);
  ok('validación (nombre, mail, teléfono, tipo, valor, plazo) -> 400 sin llamar a CM');
}

// 4. Honeypot: responde 200 y descarta.
{
  cmCalls.length = 0;
  const res = await post({ ...valid, website: 'http://spam.example' }, '10.0.0.4');
  assert.equal(res.statusCode, 200);
  assert.equal(cmCalls.length, 0, 'el honeypot no debe reenviar');
  ok('honeypot completado -> 200 sin reenviar (no delata el filtro)');
}

// 5. Rate limit: 5 envíos por IP, el sexto da 429.
{
  cmCalls.length = 0;
  for (let i = 0; i < 5; i++) {
    const res = await post(valid, '10.0.0.5');
    assert.equal(res.statusCode, 200, 'envío ' + (i + 1) + ' dentro del límite');
  }
  const res = await post(valid, '10.0.0.5');
  assert.equal(res.statusCode, 429);
  assert.equal(cmCalls.length, 5, 'el bloqueado no debe reenviarse a CM');
  ok('rate limit por IP -> 5 envíos y el sexto 429');
}

// 6. CM caído: 502 con salida de emergencia por mail.
{
  cmCalls.length = 0;
  globalThis.__cmDown = true;
  const res = await post(valid, '10.0.0.6');
  globalThis.__cmDown = false;
  assert.equal(res.statusCode, 502);
  assert.ok(res.body.error.includes('tokairwa@gmail.com'));
  ok('CM no responde -> 502 con alternativa por mail (no se simula éxito)');
}

// 7. Sin variables de entorno: 503 y nada se envía.
{
  cmCalls.length = 0;
  const savedUrl = process.env.CM_LEADS_URL;
  delete process.env.CM_LEADS_URL;
  const res = await post(valid, '10.0.0.7');
  process.env.CM_LEADS_URL = savedUrl;
  assert.equal(res.statusCode, 503);
  assert.equal(cmCalls.length, 0);
  ok('sin CM_LEADS_URL configurado -> 503 (no se filtra ni se inventa destino)');
}

// 8. Método no permitido y preflight.
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 405);
  const pre = fakeRes();
  await handler({ method: 'OPTIONS', headers: { origin: 'https://tokairwa.com' }, socket: {} }, pre);
  assert.equal(pre.statusCode, 200);
  ok('GET -> 405 y OPTIONS (preflight) -> 200');
}

global.fetch = originalFetch;
console.log('\n' + passed + ' tests OK');
