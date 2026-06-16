export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'Formato inválido' });
  }

  const SYSTEM = `Sos un asistente educativo de TOKAI RWA, un laboratorio especializado en estructuración y tokenización de activos reales.

Tu rol es responder consultas generales sobre tokenización: qué es, cómo funciona, qué activos se pueden tokenizar, marcos regulatorios, tecnología blockchain, estándares de tokens, etc.

IMPORTANTE:
- Respondés preguntas INFORMATIVAS y EDUCATIVAS sobre tokenización en general.
- NO armás proyectos, no hacés análisis financieros específicos, no estructurás emisiones.
- Si alguien quiere armar un proyecto o necesita estructuración, indicale que contacte al laboratorio TOKAI RWA directamente en contacto@tokai.com.
- Respondés en español rioplatense, tono profesional pero accesible.
- Respuestas claras y concisas: 2-3 párrafos para preguntas simples.
- Podés explicar conceptos como: tokenización, security tokens, utility tokens, ERC-3643, ERC-4626, MiCA, Howey Test, CNV, fideicomiso financiero, waterfall, LTV, etc.
- Mencionás marcos regulatorios cuando es relevante: Argentina (CNV RG 1069/1088, PSAV, UIF), USA (SEC, Reg D/A+/CF/S), UE (MiCA, MiFID II), LATAM.
- Siempre aclarás que la información es educativa y que para un proyecto real deben consultar con profesionales y con TOKAI RWA.

VERTICALES: Rodados/Movilidad, Inmobiliario, Security Tokens, Asset-Backed, Utility/Gobernanza, Financieros, Híbridos.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM,
        messages
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Error de IA' });

    const reply = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno. Intentá de nuevo.' });
  }
}
