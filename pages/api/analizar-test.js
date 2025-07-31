import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const API_RESPUESTAS = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";
const API_ENVIAR_CORREO = "https://aurea-backend-two.vercel.app/api/enviar-correo";
const API_TOKENS = "https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const { tipoInstitucion, correoSOS } = req.body;
    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);

    // 1. Obtener respuestas del test
    const respuestaRaw = await fetch(API_RESPUESTAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });
    const datos = await respuestaRaw.json();
    if (!datos.ok) return res.status(500).json({ ok: false, error: "Error al obtener respuestas del test" });

    const { usuario, sexo, fechaNacimiento, info, respuestas } = datos;

    // 2. Construir prompt
    const prompt = `
Eres AUREA, la mejor psicóloga clínica del mundo. Tu tarea es analizar un test emocional con las siguientes respuestas y generar un perfil emocional centrado en el bienestar psicológico del evaluado.

Las respuestas están organizadas como "Pregunta": "Respuesta". Sé precisa, profesional y con enfoque humano. Usa lenguaje comprensible para psicólogos o profesionales de salud mental. Si detectas un riesgo, indícalo con claridad y di a qué tema se relaciona. Si no hay señales de alerta, indícalo también.

Datos demográficos:
- Sexo: ${sexo}
- Fecha de nacimiento: ${fechaNacimiento}
- Comentario libre: ${info}

Respuestas del test:
${Object.entries(respuestas).map(([k, v]) => `${k}: ${v}`).join("\n")}

Devuelve exclusivamente un objeto JSON como este:
{
  "perfil": "Texto del perfil emocional...",
  "alertaSOS": true | false,
  "temaDetectado": "Solo si hay alertaSOS"
}
`.trim();

    // 3. Enviar a OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const contenido = completion.choices[0].message.content;
    let evaluacion;
    try {
      evaluacion = JSON.parse(contenido);
    } catch (error) {
      console.error("❌ Error al parsear JSON desde OpenAI:", contenido);
      return res.status(500).json({ ok: false, error: "Respuesta de OpenAI no es JSON válido" });
    }

    const { perfil, alertaSOS = false, temaDetectado = "" } = evaluacion;

    // 4. Llamar a enviar-correo
    fetch(API_ENVIAR_CORREO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario,
        tipoInstitucion,
        perfil,
        alertaSOS,
        temaDetectado,
        correoSOS
      })
    }).then(r => r.json()).then(r => {
      if (!r.ok) console.error("❌ Error en envío de correo:", r.error);
    });

    // 5. Registrar tokens (después del OK)
    const { prompt_tokens, completion_tokens, total_tokens } = completion.usage;
    fetch(API_TOKENS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString(),
        usuario,
        institucion: tipoInstitucion,
        inputTokens: prompt_tokens,
        outputTokens: completion_tokens,
        totalTokens: total_tokens,
        costoUSD: (total_tokens / 1000 * 0.01).toFixed(4)
      })
    }).then(r => r.json()).then(r => {
      if (!r.ok) console.error("❌ Error al registrar tokens:", r.error);
    });

    // 6. Finalizar
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
