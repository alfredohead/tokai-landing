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
  // CORS restringido al dominio propio
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin) || process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', origin || 'https://tokairwa.com');
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

  const apiKey = cleanEnv(process.env.DEEPSEEK_API_KEY) || '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';
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada' });

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
4. Invitar y persuadir al visitante a dar el paso para estructurar su proyecto con TOKAI RWA contactando por correo electrónico a tokairwa@gmail.com o por mensaje directo en Instagram en @tokairwa (https://www.instagram.com/tokairwa/).

REGLAS DE RESPUESTA:
- Respuestas directas, claras y ágiles. Evitá bloques masivos de texto o explicaciones teóricas extensas.
- Si el usuario consulta sobre cómo tokenizar su activo específico, explicále brevemente el enfoque de TOKAI e invitalo a iniciar su análisis de laboratorio escribiendo a tokairwa@gmail.com o a nuestro Instagram @tokairwa.`;

  try {
    // Modelo Llama 3.3 70B Instruct servido via NVIDIA NIM (ultra-rápido, sin saturación)
    const doCall = () => fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        max_tokens: 1024,
        temperature: 0.2,
        top_p: 0.7,
        messages: [
          { role: 'system', content: SYSTEM },
          ...messages
        ]
      })
    });

    // Manejar reintentos ante saturación de workers en NVIDIA NIM (429, 500, 502, 503, 504 ResourceExhausted)
    let response = await doCall();
    const retryStatuses = [429, 500, 502, 503, 504];
    for (let attempt = 1; retryStatuses.includes(response.status) && attempt <= 4; attempt++) {
      const delay = Math.min(500 * Math.pow(1.8, attempt - 1), 3000) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      response = await doCall();
    }

    const data = await response.json();
    if (!response.ok) {
      const isRateLimit = response.status === 429 || response.status === 503 || (data.error?.message || '').includes('limit');
      const errorMsg = isRateLimit
        ? 'El servidor de IA está recibiendo alta demanda en este momento (límite de workers alcanzado). Por favor reintentá en unos segundos.'
        : (data.error?.message || 'Error de IA');
      return res.status(response.status).json({ error: errorMsg });
    }

    const msgObj = data.choices?.[0]?.message;
    const reply = (msgObj?.content && msgObj.content.trim())
      ? msgObj.content
      : (msgObj?.reasoning_content || msgObj?.reasoning || '');
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Landing AI proxy error', err);
    return res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
  }
}
