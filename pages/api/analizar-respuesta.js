import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const {
      mensaje,
      historial = [],
      nombre = "",
      correo = "",
      institucion = "",
      tipoInstitucion = "",
      temas = [],
      calificaciones = {}
    } = req.body;

    console.log("🧠 Data recibida en Analizar del backend:", {
      mensaje,
      historial,
      nombre,
      correo,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones
    });

    const prompt = `
Eres un terapeuta virtual llamado AUREA. Tu tarea es analizar el estado emocional de la persona con base en su mensaje y los últimos 3 intercambios previos.

Contesta de forma cálida, sin emitir diagnósticos, sin exclamaciones ni promesas. Solo acompaña con preguntas profundas y técnicas de la Terapia Cognitivo Conductual (TCC) y la psicoterapia Gestalt.

Con base en las siguientes escalas psicológicas estandarizadas (PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, UCLA Soledad, SCL-90-R, BAI y BDI-II):

1. Determina cuál de los siguientes temas es el más relevante en el mensaje de la persona:
${temas.join(", ")}

2. Asigna una calificación emocional del 1 al 100 al tema elegido (100 es el nivel más alto de gravedad emocional), con base en los instrumentos mencionados.

3. Estima el porcentaje de certeza (del 1 al 100) de que esa calificación corresponde correctamente al tema detectado.

4. Justifica tu decisión clínica en máximo 3 líneas.

5. Si el nivel de certeza es menor a 90, haz una nueva pregunta para obtener más información emocional sobre ese tema.

6. Limita tu respuesta a menos de 1000 caracteres. No uses emojis ni signos de exclamación.

Datos disponibles:
- Nombre: ${nombre}
- Historial reciente:
${historial.join("\n")}
- Último mensaje del usuario: ${mensaje}
- Calificaciones previas: ${JSON.stringify(calificaciones, null, 2)}

Después de tu respuesta escribe tres guiones (\`---\`) en una nueva línea y luego en otra línea:
- SOS → si notas señales claras de crisis emocional.
- OK → si no hay señales de riesgo.
`;

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Eres un terapeuta experto en contención emocional." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
    });

    const respuesta = completion.data.choices[0].message.content;
    console.log("🧠 Para log Analizar:", respuesta);

    return res.status(200).json({ respuesta });

  } catch (error) {
    console.error("🧨 Error en analizar-respuesta:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
