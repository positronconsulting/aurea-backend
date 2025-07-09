export const config = {
  runtime: 'nodejs',
};

import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  const allowedOrigin = 'https://www.positronconsulting.com';

  // 👉 CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', allowedOrigin)
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id, x-institucion')
      .end();
  }

  // 👉 Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      historial = [],
      nombre = "",
      institucion = "",
      tema = "",
      calificacionMasAlta = null
    } = req.body;

    console.log("🧸 AUREA recibe:", { nombre, institucion, tema, calificacionMasAlta });

    const prompt = `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Tu función es acompañar a las personas en sus procesos emocionales con presencia y empatía. Utilizas herramientas de la Terapia Cognitivo Conductual (TCC), la Psicología Humanista y la psicoterapia Gestalt.

Tu tono es cercano, compasivo, reflexivo y claro. No diagnosticas, no etiquetas, no recetas. Acompañas desde el respeto y la validación emocional. Si te preguntan algo fuera de tus funciones simplemente responde de forma respetuosa que no es un tema que puedas desarrollar.

Con base en la información que recibes:
- Reconoce el tema emocional principal: ${tema}
- Si la persona tiene una calificación emocional alta (${calificacionMasAlta}/100), tenlo en cuenta para acompañar con más delicadeza.
- Apóyate en el historial para dar seguimiento al proceso.
- Dirígete a la persona por su nombre ("${nombre}"), pero no lo repitas en cada frase.
- Usa preguntas suaves, abiertas y profundas que inviten a la introspección con técnicas de TCC.
- Si notas que ha habido un patrón (por ejemplo: estrés, ansiedad o tristeza recurrentes), haz una reflexión sobre eso.
- Limita tu respuesta a un máximo de 1000 caracteres.
- No uses signos de exclamación. No prometas soluciones. Acompaña.

Después de tu respuesta, escribe tres guiones (\`---\`) en una nueva línea. Luego escribe:

- SOS → si notas señales claras de crisis emocional.
- OK → si no hay señales de riesgo.
- Luego, en otra línea, confirma el tema emocional principal detectado.

Historial reciente:
${historial.join('\n')}

Mensaje actual:
${mensaje}`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    const [respuestaLimpia, metaBloque] = raw.split('---');
    const metaLíneas = (metaBloque || "").trim().split('\n');
    const indicadorSOS = metaLíneas[0]?.toLowerCase().trim();
    const temaDetectado = metaLíneas[1]?.toLowerCase().trim() || "ninguno";
    const esSOS = indicadorSOS === "sos";

    const respuesta = (respuestaLimpia || "").trim();

    console.log("🧠 AUREA generó respuesta:", respuesta);
    console.log("📌 Meta:", { esSOS, temaDetectado });

    return res.status(200).json({
      respuesta,
      tema: temaDetectado,
      sos: esSOS
    });

  } catch (error) {
    console.error("🔥 Error general en aurea.js:", error);
    return res.status(500).json({ error: "Error interno en AUREA" });
  }
}
