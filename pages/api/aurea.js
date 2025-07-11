import { Configuration, OpenAIApi } from 'openai';

export const config = { runtime: 'nodejs' };

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones,
      tema,
      calificacion,
      porcentaje
    } = req.body;

    const historial = []; // Pendiente conectar

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios...

${nombre} mandó este mensaje: ${mensaje}, y este es el historial de la conversación: ${JSON.stringify(historial)}.

Usa este formato JSON:
{
  "mensajeUsuario": "Aquí va la respuesta de AUREA",
  "temaDetectado": "tema que hayas detectado",
  "calificacion": "calificación asignada del 1 al 100",
  "porcentaje": "porcentaje de certeza del 1 al 100",
  "SOS": "SOS o OK"
}
`.trim();

    console.log("📤 PROMPT enviado a OpenAI:", prompt);

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.data.choices[0]?.message?.content || "";
    console.log("📩 RESPUESTA raw:", raw);

    if (!raw) {
      console.warn("⚠️ OpenAI devolvió respuesta vacía");
      return res.status(200).json({
        ok: false,
        mensajeUsuario: "⚠️ No se recibió respuesta válida de OpenAI.",
        temaDetectado: "",
        calificacion: "",
        porcentaje: "",
        SOS: "OK"
      });
    }

    let respuestaParseada = {};
    try {
      respuestaParseada = JSON.parse(raw);
    } catch (error) {
      console.error("❌ Error al parsear JSON de la IA:", error);
      return res.status(200).json({
        ok: false,
        mensajeUsuario: raw,
        temaDetectado: "",
        calificacion: "",
        porcentaje: "",
        SOS: "OK"
      });
    }

    return res.status(200).json({ ok: true, ...respuestaParseada });

  } catch (err) {
    console.error("🔥 Error general en aurea.js:", err);
    return res.status(500).json({
      ok: false,
      mensajeUsuario: "🔥 Error en el servidor.",
      temaDetectado: "",
      calificacion: "",
      porcentaje: "",
      SOS: "OK"
    });
  }
}


