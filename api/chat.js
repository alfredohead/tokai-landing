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
- Si el usuario es un Emisor o empresa con un proyecto real, recomendale ingresar a la [Plataforma TOKAI](https://tokairwa.com/platform.html) para completar la encuesta del Wizard de Emisión o contactar a tokairwa@gmail.com / Instagram @tokairwa.`;

  const OPENROUTER_KEY = cleanEnv(process.env.OPENROUTER_API_KEY);
  if (!OPENROUTER_KEY) console.warn('[chat] OPENROUTER_API_KEY not set, skipping OpenRouter');

  // 0. OpenRouter (Qwen free tier)
  if (OPENROUTER_KEY) {
    try {
      const orController = new AbortController();
      const orTimer = setTimeout(() => orController.abort(), 8000);
      const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'HTTP-Referer': 'https://tokairwa.com/',
          'X-Title': 'TOKAI RWA'
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-max-free',
          max_tokens: 512,
          temperature: 0.3,
          messages: [{ role: 'system', content: SYSTEM }, ...messages]
        }),
        signal: orController.signal
      });
      clearTimeout(orTimer);

      if (orRes.ok) {
        const orData = await orRes.json();
        const reply = orData.choices?.[0]?.message?.content?.trim();
        if (reply) return res.status(200).json({ reply });
        console.error('[chat] OpenRouter ok but no reply content', JSON.stringify(orData).slice(0, 500));
      } else {
        const errBody = await orRes.text().catch(() => '');
        console.error('[chat] OpenRouter failed', orRes.status, errBody.slice(0, 500));
      }
    } catch (e) {
      console.error('[chat] OpenRouter threw', e?.name, e?.message);
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
          model: 'llama-3.3-70b-versatile',
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
        if (reply) return res.status(200).json({ reply });
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
      return res.status(200).json({ reply: bkData.reply });
    }
    console.error('[chat] Fly.io backend failed', bkRes.status, bkText.slice(0, 500));
  } catch (e) {
    console.error('[chat] Fly.io backend threw', e?.name, e?.message);
  }

  // 3. Backup terciario: NVIDIA NIM direct
  const NVIDIA_FALLBACK_CHAIN = [
    {
      model: 'meta/llama-3.3-70b-instruct',
      apiKey: cleanEnv(process.env.NVIDIA_API_KEY_1),
      temp: 0.2, topP: 0.7
    },
    {
      model: 'mistralai/mistral-medium-3.5-128b',
      apiKey: cleanEnv(process.env.NVIDIA_API_KEY_2),
      temp: 0.7, topP: 1.0
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
        if (reply) return res.status(200).json({ reply });
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
