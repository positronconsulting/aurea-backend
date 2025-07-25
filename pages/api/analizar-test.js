// ✅ /pages/api/analizar-test.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const {
      respuestas,
      comentarioLibre = "",
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      apellido = "",
      telefono = "",
      correoSOS = "",
      temasValidos = []
    } = req.body;

    console.log("📥 Data recibida en analizar-test:", {
      correo,
      institucion,
      tipoInstitucion,
      nombre,
      temasValidos,
      comentarioLibre,
      respuestas
    });

    const apiKey = process.env.OPENAI_API_KEY;

    const prompt = `
Eres AUREA, la mejor psicóloga clínica del mundo con formación en psicometría, análisis emocional, terapia cognitivo conductual, enfoque neurocognitivo conductual y psicoterapia Gestalt.

Acabas de aplicar un test inicial con reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre los siguientes temas emocionales:

${temasValidos.join(", ")}

Además, el usuario escribió un comentario libre al final.

Tu tarea es:

1. Analizar clínicamente las respuestas con base en los mejores tests psicológicos:
- PHQ-9 (depresión)
- GAD-7 (ansiedad)
- C-SSRS y Beck (suicidio)
- AUDIT y ASSIST (consumo)
- IAT (adicciones digitales)
- PSS (estrés)
- Maslach Burnout Inventory (burnout)
- SCL-90-R, BDI-II, BAI
- PSQI (sueño), UCLA (soledad), Y-BOCS (TOC), Rosenberg (autoestima)

2. Asignar una calificación emocional del 1 al 100 para cada uno de los temas analizados, exactamente en el orden recibido, y basándote en los tests adecuados. Usa solo los temas recibidos.

3. Detectar si el usuario podría haber respondido de forma inconsistente, sin leer o al azar. Si lo detectas, descríbelo como una observación.

4. Redactar un perfil emocional clínico inicial, profesional pero claro, orientado a RRHH o psicología institucional. Resume los hallazgos más relevantes, el estado emocional general, puntos de atención y fortalezas.

5. Detectar si hay señales de riesgo psicológico o emocional. Si identificas señales de crisis, suicidio, violencia, acoso, encierro, bulimia, anorexia, violación, ludopatía o burnout extremo, escribe exactamente: "SOS". Si no hay señales críticas, escribe "OK".

Usa el siguiente formato JSON:

{
  "calificaciones": {
    "tema1": 45,
    "tema2": 80,
    ...
  },
  "perfil": "Aquí va el resumen clínico orientado a RRHH y psicólogos institucionales",
  "SOS": "SOS o OK",
  "observaciones": "Si hubo patrones de falsedad o aleatoriedad. Si no, dejar en blanco."
}
    `.trim();

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "user", content: prompt },
          {
            role: "user",
            content: `Estas son las respuestas del usuario:\n\n${JSON.stringify(respuestas, null, 2)}\n\nComentario final:\n${comentarioLibre}`
          }
        ],
        temperature: 0.4,
        max_tokens: 1500
      })
    });

    const data = await openAiResponse.json();
    console.log("📩 Respuesta de OpenAI cruda:", data);

    if (!data.choices || !data.choices[0]?.message?.content) {
      return res.status(500).json({ ok: false, error: "Respuesta vacía de OpenAI" });
    }

    let json;
    try {
      json = JSON.parse(data.choices[0].message.content);
    } catch (err) {
      console.error("❌ No se pudo parsear JSON:", err);
      return res.status(500).json({ ok: false, error: "Formato inválido en la respuesta de OpenAI" });
    }

    console.log("✅ JSON interpretado:", json);

    return res.status(200).json({
      ok: true,
      calificaciones: json.calificaciones || {},
      perfil: json.perfil || "",
      SOS: json.SOS || "OK",
      observaciones: json.observaciones || ""
    });

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
