/*
 * api/diagnostico.js — endpoint del formulario de la página /diagnostico/.
 *
 * Qué hace: valida el formulario del sitio, limita el rate por IP y reenvía el lead
 * al mismo endpoint de ingesta de CM que usa api/chat.js (postLeadToCM), con las
 * mismas variables de entorno del servidor: CM_LEADS_URL y LEAD_INGEST_SECRET.
 * No hay claves ni URLs de ingesta en el código.
 *
 * Origen: el contrato de CM no admite un 'source' por lead — su ingesta fija source='chatbot'
 * para todo lo que entra por /api/leads/ingest (ver CM/server/leads.ts) — así que el origen se
 * antepone a notes como "[origen: diagnostico] <utm_source>/<utm_medium>/<utm_campaign> | <referrer>",
 * el mismo criterio que usa el chat con "[origen: ...]". El campo origin (string) se sigue mandando:
 * hoy CM lo ignora, y queda correcto si suma el campo.
 */
import { postLeadToCM } from './chat.js';

const RATE_LIMIT = 5;                 // envíos
const RATE_WINDOW = 10 * 60 * 1000;   // por 10 minutos y por IP
const MAX_BODY = 8 * 1024;            // 8 KB

const rateLimit = new Map();
const ALLOWED_ORIGINS = new Set([
  'https://www.tokairwa.com',
  'https://tokairwa.com',
  'https://tokairwa.vercel.app',
  'https://tokairwa.online',
  'https://www.tokairwa.online',
]);

// Valores de los <select> de la página -> etiqueta legible para el CRM.
const ASSET_TYPES = {
  inmobiliario: 'Inmobiliario (terreno, edificio, desarrollo, renta)',
  rodados: 'Rodados y flotas (autos, camiones, maquinaria)',
  agro: 'Agro (campo, producción, acopio)',
  energia: 'Energía e infraestructura',
  mineria: 'Minería y commodities',
  credito: 'Crédito, cuentas por cobrar o leasing',
  equity: 'Participación societaria o deuda corporativa',
  otro: 'Otro / no estoy seguro',
};

const ASSET_VALUES = {
  'hasta-100k': 'Hasta USD 100.000',
  '100k-500k': 'USD 100.000 - 500.000',
  '500k-2m': 'USD 500.000 - 2.000.000',
  '2m-10m': 'USD 2.000.000 - 10.000.000',
  'mas-10m': 'Más de USD 10.000.000',
  'no-definido': 'Todavía no lo definí',
};

const TIMELINES = {
  '0-6': 'Menos de 6 meses',
  '6-12': 'Entre 6 y 12 meses',
  '12-24': 'Entre 12 y 24 meses',
  'mas-24': 'Más de 24 meses',
  'no-definido': 'Sin plazo definido',
};

const HIGH_VALUE = new Set(['500k-2m', '2m-10m', 'mas-10m']);
const NEAR_TERM = new Set(['0-6', '6-12']);

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function cleanEnv(value) {
  return (value || '').replace(/^\uFEFF/, '').trim();
}

// Puntaje para la planilla de leads (A/B/C), con el mismo criterio del chatbot:
// A = activo de valor alto con necesidad en menos de 12 meses; B = interés claro con
// plazo o valor poco definido; C = consulta general.
function scoreFor(assetValue, timeline) {
  if (HIGH_VALUE.has(assetValue) && NEAR_TERM.has(timeline)) return 'A';
  if (assetValue !== 'no-definido' || NEAR_TERM.has(timeline)) return 'B';
  return 'C';
}

function sanitizeOrigin(o) {
  if (!o || typeof o !== 'object') return null;
  const clip = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
  const out = {
    utm_source: clip(o.utm_source), utm_medium: clip(o.utm_medium),
    utm_campaign: clip(o.utm_campaign), referrer: clip(o.referrer),
  };
  return out;
}

function formatOrigin(o) {
  const part = (v) => v || '-';
  const utmPart = `${part(o.utm_source)}/${part(o.utm_medium)}/${part(o.utm_campaign)}`;
  const ref = part(o.referrer);
  if (utmPart === '-/-/-' && ref === '-') return '';
  return `${utmPart} | ${ref}`;
}

function str(v, max) {
  return (typeof v === 'string' ? v.trim().slice(0, max) : '');
}

export function validateDiagnostic(body) {
  const b = (body && typeof body === 'object') ? body : {};
  const name = str(b.name, 120);
  const email = str(b.email, 200).toLowerCase();
  const phone = str(b.phone, 60);
  const assetType = str(b.assetType, 40);
  const assetValue = str(b.assetValue, 40);
  const timeline = str(b.timeline, 40);
  const notes = str(b.notes, 1000);

  if (name.length < 2) return { error: 'Ingresá tu nombre.', status: 400 };
  if (!EMAIL_RE.test(email)) return { error: 'Ingresá un mail válido.', status: 400 };
  if (phone && phone.replace(/\D/g, '').length < 6) return { error: 'El teléfono no parece válido.', status: 400 };
  if (!ASSET_TYPES[assetType]) return { error: 'Elegí el tipo de activo.', status: 400 };
  if (!ASSET_VALUES[assetValue]) return { error: 'Elegí el valor aproximado.', status: 400 };
  if (!TIMELINES[timeline]) return { error: 'Elegí el plazo.', status: 400 };
  // El consentimiento es obligatorio: sin él no se guarda nada.
  if (b.consent !== true) return { error: 'Necesitamos tu consentimiento para contactarte.', status: 422 };

  return {
    lead: {
      name, email, phone: phone || null,
      assetType: ASSET_TYPES[assetType],
      assetValue: ASSET_VALUES[assetValue],
      timeline: TIMELINES[timeline],
      notes: notes || 'Diagnóstico de 20 minutos solicitado desde tokairwa.com/diagnostico/',
      score: scoreFor(assetValue, timeline),
      consent: true,
    },
  };
}

export default async function handler(req, res) {
  // CORS restringido a los dominios de TOKAI (igual que api/chat.js).
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin) || process.env.NODE_ENV !== 'production' || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Rate limit por IP.
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimit.set(ip, entry);
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Ya recibimos tu solicitud. Si necesitás corregir algo, escribinos a tokairwa@gmail.com.' });
  }

  // Tamaño máximo del cuerpo.
  let raw = '';
  try { raw = JSON.stringify(req.body || {}); } catch { raw = ''; }
  if (raw.length > MAX_BODY) return res.status(413).json({ error: 'El envío es demasiado grande.' });

  const body = req.body || {};
  // Honeypot: si un bot completa este campo oculto, se responde OK y no se reenvía nada.
  if (str(body.website, 200)) return res.status(200).json({ ok: true });

  const { lead, error, status } = validateDiagnostic(body);
  if (error) return res.status(status).json({ error });

  if (!cleanEnv(process.env.CM_LEADS_URL) || !cleanEnv(process.env.LEAD_INGEST_SECRET)) {
    console.error('[diagnostico] CM_LEADS_URL / LEAD_INGEST_SECRET no configurados');
    return res.status(503).json({ error: 'El canal de contacto no está disponible. Escribinos a tokairwa@gmail.com.' });
  }

  const originStr = formatOrigin(sanitizeOrigin(body.origin));
  const sent = await postLeadToCM(lead, originStr, 'diagnostico');
  if (!sent) {
    return res.status(502).json({ error: 'No pudimos registrar tu solicitud. Escribinos a tokairwa@gmail.com.' });
  }
  return res.status(200).json({ ok: true });
}
