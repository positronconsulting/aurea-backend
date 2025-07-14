// archivo: /api/analizar-test.js (Vercel Middleware)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { respuestas, comentarioLibre, correo, nombre, institucion, tipoInstitucion, temasValidos } = req.body;

    console.log("📥 Data recibida en analizar-test:", {
      respuestas,
      comentarioLibre,
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      temasValidos
    });

    const apiKey = process.env.OPENAI_API_KEY;

    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a un usuario que respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre los siguientes temas emocionales:

${temasValidos.join(", ")}

Además, el usuario escribió un comentario libre al final.

Tu tarea es:

1. **Analizar clínicamente las respuestas** según criterios de escalas estandarizadas como:
   - PHQ-9 (depresión)
   - GAD-7 (ansiedad)
   - C-SSRS y Escala de desesperanza de Beck (suicidio)
   - AUDIT y ASSIST (consumo)
   - PSS (estrés)
   - Maslach Burnout Inventory (burnout)
   - SCL-90-R (evaluación general de síntomas)
   - Rosenberg (autoestima)
   - IAT (adicciones digitales)
   - PSQI (sueño)
   - Escala de soledad UCLA
   - Y-BOCS (TOC)

2. **Asignar una calificación emocional del 1 al 100** para cada tema detectado en las respuestas. Solo califica los temas que estén claramente reflejados en las respuestas. Si no hay información suficiente sobre un tema, **no lo incluyas**.

3. **Redactar un perfil emocional breve** (2 a 4 frases), con un lenguaje empático, humano y profesional, que resuma el estado emocional de la persona basado en su test. Usa un tono comprensivo, sin juicios ni tecnicismos innecesarios.

4. **Detectar señales de alto riesgo**. Si identificas indicadores claros de suicidio, psicosis, violencia severa o abuso (familiar, sexual, etc.), responde exactamente:  
   "SOS"  
   En cualquier otro caso responde simplemente:  
   "OK"

**Instrucciones estrictas:**
- Devuelve la información como un JSON con exactamente esta estructura:

{
  "calificaciones": {
    "Depresión": 72,
    "Ansiedad": 64,
    ...
  },
  "perfil": "Texto del perfil emocional en tono profesional y empático.",
  "SOS": "OK" // o "SOS"
}

Respuestas del usuario:
${JSON.stringify(respuestas, null, 2)}

Comentario libre:
"${comentarioLibre}"
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
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await openAiResponse.json();
    console.log("📩 Respuesta de OpenAI:", data);

    if (!data.choices || !data.choices[0]?.message?.content) {
      return res.status(500).json({ ok: false, error: "Respuesta vacía de OpenAI" });
    }

    let resultado;
    try {
      resultado = JSON.parse(data.choices[0].message.content);
    } catch (err) {
      console.error("❌ Error al parsear JSON:", err);
      return res.status(500).json({ ok: false, error: "Formato inválido" });
    }

    return res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    console.error("🔥 Error en analizar-test:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}

