// ✅ /api/analizar-test.js (Vercel Middleware)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { respuestas, comentarioLibre, correo, nombre, institucion, tipoInstitucion, temasValidos } = req.body;

    if (!respuestas || !comentarioLibre || !correo || !nombre || !institucion || !tipoInstitucion || !temasValidos) {
      return res.status(400).json({ ok: false, error: "Faltan parámetros obligatorios" });
    }

    console.log("📥 Data recibida en analizar-test:", {
      correo,
      institucion,
      tipoInstitucion,
      nombre,
      temasValidos,
      comentarioLibre,
      respuestas
    });

    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a un usuario que respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre los siguientes temas emocionales:

${temasValidos.join(", ")}

Además, el usuario escribió un comentario libre al final.

Tu tarea es:

1. Analizar clínicamente las respuestas según criterios de escalas estandarizadas como:
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

2. SIEMPRE Asignar una calificación emocional del 1 al 100 para cada tema que te mandé arriba.

3. Redactar un perfil emocional dirigido al encargado de Aurea en la institución. Hazlo con un lenguaje empático, humano y profesional, que resuma el estado emocional de la persona basado en su test. Usa un tono comprensivo, sin juicios ni tecnicismos innecesarios.

4. IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia, violación, ludopatía o trastornos alimenticios, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Instrucciones estrictas:
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

    const apiKey = process.env.OPENAI_API_KEY;
    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await openAiResponse.json();
    console.log("📩 Respuesta de OpenAI cruda:", data);

    if (!data?.choices?.[0]?.message?.content) {
      console.error("❌ Respuesta vacía de OpenAI");
      return res.status(500).json({ ok: false, error: "Respuesta vacía de OpenAI" });
    }

    let resultado;
    try {
      resultado = JSON.parse(data.choices[0].message.content);
      console.log("✅ JSON interpretado:", resultado);
    } catch (err) {
      console.error("❌ Error al parsear JSON:", err);
      return res.status(500).json({ ok: false, error: "Formato inválido en la respuesta de OpenAI" });
    }

    // ✅ Registro de uso de tokens
    const usage = data.usage || {};
    const costoUSD = usage.total_tokens ? usage.total_tokens * 0.00001 : 0;

    try {
      await fetch("https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: new Date().toISOString(),
          usuario: correo,
          institucion,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          costoUSD: parseFloat(costoUSD.toFixed(6))
        })
      });
      console.log("🧾 Tokens registrados correctamente.");
    } catch (e) {
      console.warn("⚠️ Error al registrar tokens:", e.message);
    }

    return res.status(200).json({
      ok: true,
      calificaciones: resultado.calificaciones || {},
      perfil: resultado.perfil || "",
      SOS: resultado.SOS || "OK",
      usage
    });

  } catch (err) {
    console.error("🔥 Error general en analizar-test:", err);
    return res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
}

