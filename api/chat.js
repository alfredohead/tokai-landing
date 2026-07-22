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
  const model = cleanEnv(process.env.DEEPSEEK_MODEL) || 'deepseek-ai/deepseek-v4-flash';
  return (model === 'deepseek-chat' || model === 'deepseek-v4-flash')
    ? 'deepseek-ai/deepseek-v4-flash'
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

  const SYSTEM = `Sos un asistente educativo de TOKAI RWA, un laboratorio especializado en estructuración y tokenización de activos reales.

Tu rol es responder consultas generales sobre tokenización: qué es, cómo funciona, qué activos se pueden tokenizar, marcos regulatorios, tecnología blockchain, estándares de tokens, etc.

IMPORTANTE:
- Respondés preguntas INFORMATIVAS y EDUCATIVAS sobre tokenización en general.
- NO armás proyectos, no hacés análisis financieros específicos, no estructurás emisiones.
- Si alguien quiere armar un proyecto o necesita estructuración, indicale que contacte al laboratorio TOKAI RWA directamente en tokairwa@gmail.com.
- Respondés en español rioplatense, tono profesional pero accesible.
- Respuestas claras y concisas: 2-3 párrafos para preguntas simples.
- Mencionás marcos regulatorios cuando es relevante: Argentina (CNV RG 1069/1088, PSAV, UIF), USA (SEC, Reg D/A+/CF/S), UE (MiCA, MiFID II), LATAM.
- Siempre aclarás que la información es educativa y que para un proyecto real deben consultar con profesionales y con TOKAI RWA.
- Destacás que TOKAI cuenta con una arquitectura de emisión universal multi-estándar en Polygon: ERC-3643 (T-REX para security tokens con compliance), ERC-721 (Certificados de fideicomiso soulbound como PreGAT), ERC-20 (Utility tokens), ERC-1155 (Colecciones semi-fungibles) y ERC-4626/7540 (Bóvedas de rendimiento/liquidez).

VERTICALES: Rodados/Movilidad, Inmobiliario, Security Tokens, Asset-Backed, Utility/Gobernanza, Financieros, Híbridos.`;

  try {
    // DeepSeek servido via NVIDIA NIM (endpoint OpenAI-compatible).
    const doCall = () => fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: deepSeekModel(),
        max_tokens: 16384,
        temperature: 1,
        top_p: 0.95,
        chat_template_kwargs: {
          thinking: true,
          reasoning_effort: "high"
        },
        messages: [
          { role: 'system', content: SYSTEM },
          ...messages
        ]
      })
    });

    // El pool de workers gratuito de NVIDIA NIM se satura seguido (503 ResourceExhausted,
    // se observó cola de cientos de requests contra 48 workers) — con 3 intentos y backoff
    // corto la probabilidad de éxito sube bastante sin sumar demasiada latencia percibida.
    let response = await doCall();
    for (let attempt = 1; response.status === 503 && attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      response = await doCall();
    }

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de IA' });

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
