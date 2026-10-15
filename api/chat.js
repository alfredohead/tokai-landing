const rateLimit = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60 * 1000;
const ALLOWED_ORIGINS = new Set([
  'https://www.tokairwa.com',
  'https://tokairwa.com',
  'https://tokairwa.vercel.app',
  'https://tokairwa.online',
  'https://www.tokairwa.online',
]);

function cleanEnv(value) {
  return (value || '').replace(/^\uFEFF/, '').trim();
}

function deepSeekModel() {
  const model = cleanEnv(process.env.DEEPSEEK_MODEL) || 'meta/llama-3.3-70b-instruct';
  return (model === 'deepseek-chat' || model === 'deepseek-v4-flash')
    ? 'meta/llama-3.3-70b-instruct'
    : model;
}


// ---- Captación de leads (calificador) ----
const CONSENT_NOTICE = 'Usaremos estos datos solo para contactarte por tu consulta. ¿Estás de acuerdo?';
const LEAD_RE = /\[\[LEAD:(\{[\s\S]*?\})\]\]/;

function extractLead(reply) {
  const m = reply.match(LEAD_RE);
  const visible = reply.replace(/\[\[LEAD:[\s\S]*?\]\]/g, '').trim();
  if (!m) return { visible, lead: null };
  try { return { visible, lead: JSON.parse(m[1]) }; } catch { return { visible, lead: null }; }
}

// Atribución de origen (UTM + referrer) enviada por el widget del sitio junto a 'messages'.
// No forma parte del contrato previo con CM: se agrega como campo adicional y, para que
// llegue aunque CM ignore el campo nuevo, también se antepone a 'notes'.
function sanitizeOrigin(o) {
  if (!o || typeof o !== 'object') return null;
  const clip = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
  return {
    utm_source: clip(o.utm_source), utm_medium: clip(o.utm_medium),
    utm_campaign: clip(o.utm_campaign), referrer: clip(o.referrer),
  };
}

function formatOrigin(o) {
  if (!o) return '';
  const part = (v) => v || '-';
  const utmPart = `${part(o.utm_source)}/${part(o.utm_medium)}/${part(o.utm_campaign)}`;
  const ref = part(o.referrer);
  if (utmPart === '-/-/-' && ref === '-') return ''; // sin UTM ni referrer: nada que reportar
  return `${utmPart} | ${ref}`;
}

// Envía al endpoint de ingesta de CM un lead ya validado.
// Compartido con api/diagnostico.js: mismo contrato, mismas variables de entorno
// (CM_LEADS_URL + LEAD_INGEST_SECRET). Sin claves en el código.
// originStr se antepone a 'notes' porque CM fija source='chatbot' en la ingesta
// y su esquema descarta campos extra: así el origen llega aunque no sea un campo propio.
// 'tag' (opcional) etiqueta la fuente del lead, p. ej. 'diagnostico'.
export async function postLeadToCM(lead, originStr, tag) {
  const url = cleanEnv(process.env.CM_LEADS_URL);
  const secret = cleanEnv(process.env.LEAD_INGEST_SECRET);
  if (!url || !secret || !lead) return false;
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : null);
  let notes = str(lead.notes, 1500);
  const marker = tag
    ? `[origen: ${tag}]${originStr ? ' ' + originStr : ''}`
    : (originStr ? `[origen: ${originStr}]` : '');
  if (marker) notes = `${marker} ${notes || ''}`.trim().slice(0, 1500);
  const body = {
    name: str(lead.name, 160), email: str(lead.email, 200), phone: str(lead.phone, 60),
    assetType: str(lead.assetType, 120), assetValue: str(lead.assetValue, 120), timeline: str(lead.timeline, 120),
    notes, score: ['A', 'B', 'C'].includes(lead.score) ? lead.score : 'C',
    consent: lead.consent === true,
    origin: originStr ? (tag ? `${tag} | ${originStr}` : originStr) : (tag || null),
  };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-lead-secret': secret },
      body: JSON.stringify(body)
    });
    clearTimeout(t);
    if (!r.ok) { console.error('[lead] rechazado', r.status); return false; }
    return true;
  } catch (e) {
    console.error('[lead] error', e?.name, e?.message);
    return false;
  }
}

async function submitLead(lead, messages, origin) {
  // El aviso de uso de datos debe haber sido mostrado por el asistente antes de captar el contacto.
  const noticeShown = messages.some(m => m.role === 'assistant' && String(m.content).includes('Usaremos estos datos'));
  if (!noticeShown) return;
  await postLeadToCM(lead, formatOrigin(origin));
}


// Extracción determinística: no depende de que el modelo emita el marcador (puede cortarse por max_tokens).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const YES_RE = /(^|[^\p{L}])(sí|si|de acuerdo|acepto|ok|dale|claro|por supuesto|perfecto|está bien|esta bien)(?![\p{L}])/iu;

function deterministicLead(messages) {
  const idx = messages.findIndex(m => m.role === 'assistant' && String(m.content).includes('Usaremos estos datos'));
  if (idx === -1) return null;
  const after = messages.slice(idx + 1).filter(m => m.role === 'user').map(m => String(m.content));
  if (after.length === 0 || !YES_RE.test(after[0])) return null;      // debe haber aceptado explícitamente
  const text = after.join(' ');
  const email = (text.match(EMAIL_RE) || [null])[0];
  const phoneRaw = (text.replace(EMAIL_RE, ' ').match(PHONE_RE) || [null])[0];
  const phone = phoneRaw ? phoneRaw.trim() : null;
  if (!email && !phone) return null;
  const all = messages.filter(m => m.role === 'user').map(m => String(m.content)).join(' ');
  const nameMatch = text.match(/(?:[Ss]oy|[Mm]e llamo|[Mm]i nombre es)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,2})/);
  const bigValue = /millon|millón|\bUSD?\s*\d{3}[.,]?\d{3}|u\$s\s*\d/i.test(all);
  const soon = /\b([1-9]|1[0-2])\s*mes/i.test(all) || /urgent|inmediat|este año/i.test(all);
  const assetish = /inmueble|edificio|desarroll|campo|tierra|flota|veh[ií]culo|proyecto|oficina|lote|energ|miner/i.test(all);
  const score = bigValue && soon && assetish ? 'A' : (assetish ? 'B' : 'C');
  return {
    name: nameMatch ? nameMatch[1].trim() : null, email, phone,
    assetType: null, assetValue: null, timeline: null,
    notes: all.slice(0, 1400), score, consent: true,
  };
}

async function sendReply(res, reply, messages, origin) {
  const { visible, lead } = extractLead(reply);
  const base = deterministicLead(messages);
  let merged = null;
  if (lead && base) {
    const keep = (a, b) => (typeof a === 'string' && a.trim() ? a : b);
    merged = {
      name: keep(lead.name, base.name), email: keep(lead.email, base.email), phone: keep(lead.phone, base.phone),
      assetType: keep(lead.assetType, base.assetType), assetValue: keep(lead.assetValue, base.assetValue),
      timeline: keep(lead.timeline, base.timeline), notes: keep(lead.notes, base.notes),
      score: ['A', 'B', 'C'].includes(lead.score) ? lead.score : base.score, consent: true,
    };
  } else {
    merged = base;   // sin marcador válido, usa la extracción determinística
  }
  await submitLead(merged, messages, origin);
  return res.status(200).json({ reply: visible || reply });
}

export default async function handler(req, res) {
  // CORS universal para la API pública de la landing
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

  // Rate limiting por IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimit.set(ip, entry);
  if (entry.count > RATE_LIMIT) return res.status(429).json({ error: 'Demasiadas solicitudes. Esperá un momento.' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'Formato inválido' });
  }
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string' || msg.content.length > 2000) {
      return res.status(400).json({ error: 'Mensaje inválido' });
    }
  }
  const leadOrigin = sanitizeOrigin(req.body?.origin);

  const SYSTEM = `Sos el asistente interactivo de TOKAI RWA, un laboratorio especializado en diseñar, estructurar y ejecutar proyectos de tokenización de activos reales (RWA) en Argentina y LATAM.

Tu función es:
1. Explicar qué hace TOKAI RWA y cómo podemos colaborar con emisores, empresas y propietarios para transformar activos reales (inmobiliario, rodados/flotas, crédito, commodities, security tokens, etc.) en activos digitales tokenizados.
2. Responder sobre tokenización de forma INTUITIVA, CONCISA y FÁCIL DE ENTENDER (máximo 2 a 3 párrafos breves por respuesta). Utilizá un tono profesional rioplatense, persuasivo y accesible, manteniendo el rigor técnico justo sin abrumar con tecnicismos extensos.
3. Mostrar cómo TOKAI acompaña al emisor en las 4 capas de un proyecto: Estructuración Financiera (tokenomics/waterfall), Marco Legal & Regulatorio (CNV, SEC, MiCA), Arquitectura Tecnológica (ERC-3643, ERC-721, ERC-4626 en Polygon) y Estrategia de Emisión.
4. Invitar y persuadir a los EMISORES que desean tokenizar un activo a:
   - **Completar el Diagnóstico Automatizado en la Plataforma**: Ingresar a la [Plataforma TOKAI](https://tokairwa.com/platform.html) para realizar el Wizard de Clasificación y Diagnóstico del Emisor.
   - **Contacto Directo con el Laboratorio**: Escribir por mail a tokairwa@gmail.com o enviar un DM a nuestro Instagram en @tokairwa (https://www.instagram.com/tokairwa/).

REGLAS DE RESPUESTA:
- Respuestas directas, claras y ágiles. Evitá bloques masivos de texto o explicaciones teóricas extensas.
- Si el usuario es un Emisor o empresa con un proyecto real, recomendale ingresar a la [Plataforma TOKAI](https://tokairwa.com/platform.html) para completar la encuesta del Wizard de Emisión o contactar a tokairwa@gmail.com / Instagram @tokairwa.

CALIFICACIÓN DE EMISORES (captación de contactos):
- Si la persona es dueña o desarrolladora de un activo y muestra interés, hacé UNA pregunta por mensaje, de forma natural: 1) qué tipo de activo es, 2) valor aproximado, 3) en qué plazo necesita financiamiento o liquidez.
- Antes de pedir el consentimiento y los datos de contacto, preguntá UNA sola vez y de forma breve: "Por cierto, ¿cómo nos conociste?" (ej. LinkedIn, Instagram, buscador, recomendación). Si no responde o cambia de tema, no insistas y seguí sin ese dato.
- Luego ofrecé que el equipo la contacte y pedí nombre y un mail o WhatsApp. ANTES de pedir los datos de contacto, mostrá exactamente esta frase: "Usaremos estos datos solo para contactarte por tu consulta. ¿Estás de acuerdo?" y esperá su respuesta afirmativa.
- Solo si la persona aceptó y dio un medio de contacto, agregá AL FINAL de tu respuesta, en una línea aparte, este marcador con JSON válido (sin texto después): [[LEAD:{"name":"","email":"","phone":"","assetType":"","assetValue":"","timeline":"","notes":"si respondió cómo te conoció, empezá con [conocio: <respuesta breve>] seguido de un resumen breve de lo que busca; si no respondió, solo el resumen breve","score":"A","consent":true}]]
- score: A = activo de alto valor (por ejemplo inmueble o proyecto) con necesidad en menos de 12 meses; B = interés claro pero plazo o valor poco definido; C = consulta general o estudiante.
- Nunca prometas rendimientos ni retornos, nunca hables de ofertas de inversión concretas, y aclará que tu información es orientativa y no constituye recomendación de inversión.
- No muestres el marcador [[LEAD...]] en el texto que ves como explicación: solo va como última línea cuando corresponde.`;

  // 0. TokenRouter (OpenAI-compatible gateway) — intenta cada modelo/key configurado en orden
  const TOKENROUTER_CHAIN = [
    { model: 'qwen/qwen3.8-max-free', apiKey: cleanEnv(process.env.TOKENROUTER_API_KEY) },
    { model: 'deepseek/deepseek-v4-pro-0813-free', apiKey: cleanEnv(process.env.TOKENROUTER_API_KEY_2) }
  ].filter(config => config.apiKey);

  if (TOKENROUTER_CHAIN.length === 0) console.warn('[chat] no TOKENROUTER_API_KEY(_2) set, skipping TokenRouter');

  for (const config of TOKENROUTER_CHAIN) {
    try {
      const trController = new AbortController();
      const trTimer = setTimeout(() => trController.abort(), 15000);
      const trRes = await fetch('https://api.tokenrouter.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 512,
          temperature: 0.3,
          messages: [{ role: 'system', content: SYSTEM }, ...messages]
        }),
        signal: trController.signal
      });
      clearTimeout(trTimer);

      if (trRes.ok) {
        const trData = await trRes.json();
        const reply = trData.choices?.[0]?.message?.content?.trim();
        if (reply) return sendReply(res, reply, messages, leadOrigin);
        console.error('[chat] TokenRouter ok but no reply content', config.model, JSON.stringify(trData).slice(0, 500));
      } else {
        const errBody = await trRes.text().catch(() => '');
        console.error('[chat] TokenRouter failed', config.model, trRes.status, errBody.slice(0, 500));
      }
    } catch (e) {
      console.error('[chat] TokenRouter threw', config.model, e?.name, e?.message);
    }
  }

  const GROQ_KEY = cleanEnv(process.env.GROQ_API_KEY);
  if (!GROQ_KEY) console.warn('[chat] GROQ_API_KEY not set, skipping Groq');

  // 1. Inferencia LPU ultra-rápida directa a Groq API (~500ms a 800ms)
  if (GROQ_KEY) {
    try {
      const groqController = new AbortController();
      const groqTimer = setTimeout(() => groqController.abort(), 7000);
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          max_tokens: 512,
          temperature: 0.3,
          messages: [{ role: 'system', content: SYSTEM }, ...messages]
        }),
        signal: groqController.signal
      });
      clearTimeout(groqTimer);

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        const reply = groqData.choices?.[0]?.message?.content?.trim();
        if (reply) return sendReply(res, reply, messages, leadOrigin);
        console.error('[chat] Groq ok but no reply content', JSON.stringify(groqData).slice(0, 500));
      } else {
        const errBody = await groqRes.text().catch(() => '');
        console.error('[chat] Groq failed', groqRes.status, errBody.slice(0, 500));
      }
    } catch (e) {
      console.error('[chat] Groq threw', e?.name, e?.message);
    }
  }

  // 2. Backup secundario: backend Fly.io
  try {
    const bkController = new AbortController();
    const bkTimer = setTimeout(() => bkController.abort(), 10000);
    const bkRes = await fetch('https://tokai-backend.fly.dev/api/v1/ai/public-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: bkController.signal
    });
    clearTimeout(bkTimer);
    const bkText = await bkRes.text();
    const bkData = (() => { try { return JSON.parse(bkText); } catch { return {}; } })();
    if (bkRes.ok && bkData.reply) {
      return sendReply(res, String(bkData.reply), messages, leadOrigin);
    }
    console.error('[chat] Fly.io backend failed', bkRes.status, bkText.slice(0, 500));
  } catch (e) {
    console.error('[chat] Fly.io backend threw', e?.name, e?.message);
  }

  // 3. Backup terciario: NVIDIA NIM direct
  // mistralai/mistral-medium-3.5-128b fue retirado del catálogo de NVIDIA (HTTP 410,
  // confirmado en logs de producción el 2026-08-20) — sacado de la cadena.
  const NVIDIA_FALLBACK_CHAIN = [
    {
      model: 'meta/llama-3.3-70b-instruct',
      apiKey: cleanEnv(process.env.NVIDIA_API_KEY_1),
      temp: 0.2, topP: 0.7
    }
  ].filter(config => config.apiKey);

  if (NVIDIA_FALLBACK_CHAIN.length === 0) console.warn('[chat] no NVIDIA_API_KEY_1/2 set, skipping NVIDIA fallback');

  for (const config of NVIDIA_FALLBACK_CHAIN) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 512,
          temperature: config.temp,
          top_p: config.topP,
          messages: [{ role: 'system', content: SYSTEM }, ...messages]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json();
        const msgObj = data.choices?.[0]?.message;
        const reply = msgObj?.content?.trim();
        if (reply) return sendReply(res, reply, messages, leadOrigin);
        console.error('[chat] NVIDIA ok but no reply content', config.model);
      } else {
        const errBody = await response.text().catch(() => '');
        console.error('[chat] NVIDIA failed', config.model, response.status, errBody.slice(0, 500));
      }
    } catch (err) {
      clearTimeout(timer);
      console.error('[chat] NVIDIA threw', config.model, err?.name, err?.message);
    }
  }

  console.error('[chat] all providers exhausted, returning 500');
  return res.status(500).json({ error: 'Servicio de consulta ocupado momentáneamente. Por favor intentá de nuevo.' });
}

// Exports con nombre para test local (no afectan a Vercel, que usa el default export).
export { sanitizeOrigin, formatOrigin, extractLead, deterministicLead };
