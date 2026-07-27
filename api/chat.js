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

  // 1. Intentar primero via backend Fly.io (servidor persistente sin límite de 10s y con fallback a Claude Haiku en ~1.2s)
  try {
    const bkController = new AbortController();
    const bkTimer = setTimeout(() => bkController.abort(), 7500);
    const bkRes = await fetch('https://tokai-backend.fly.dev/api/v1/ai/public-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: bkController.signal
    });
    clearTimeout(bkTimer);
    const bkData = await bkRes.json().catch(() => ({}));
    if (bkRes.ok && bkData.reply) {
      return res.status(200).json({ reply: bkData.reply });
    }
  } catch (e) {
    // Si el backend Fly.io falla o demora, continuar con llamadas directas a NVIDIA NIM
  }

  // 2. Fallback secundario directo a NVIDIA NIM API (con timeout rápido de 4s por candidato para no exceder los 10s de Vercel)
  const NVIDIA_FALLBACK_CHAIN = [
    {
      model: 'meta/llama-3.3-70b-instruct',
      apiKey: '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',
      temp: 0.2, topP: 0.7
    },
    {
      model: 'mistralai/mistral-medium-3.5-128b',
      apiKey: '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',
      temp: 0.7, topP: 1.0
    },
    {
      model: 'google/gemma-4-31b-it',
      apiKey: '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',
      temp: 0.7, topP: 0.95
    }
  ];

  let lastErr = null;
  for (const config of NVIDIA_FALLBACK_CHAIN) {
    const payload = {
      model: config.model,
      max_tokens: 512,
      temperature: config.temp,
      top_p: config.topP,
      messages: [
        { role: 'system', content: SYSTEM },
        ...messages
      ]
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const msgObj = data.choices?.[0]?.message;
      const reply = (msgObj?.content && msgObj.content.trim())
        ? msgObj.content
        : (msgObj?.reasoning_content || msgObj?.reasoning || '');

      if (reply) {
        return res.status(200).json({ reply });
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }

  return res.status(500).json({ error: 'Servicio de consulta no disponible momentáneamente. Intentá de nuevo.' });
}
