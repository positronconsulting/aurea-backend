// ✅ api/analizar-test.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
      genero,
      fechaNacimiento,
      temasValidos = []
    } = req.body;

    console.log("📥 Data recibida en analizar-test:", {
      correo, institucion, tipoInstitucion, nombre, genero, fechaNacimiento, temasValidos, comentarioLibre, respuestas
    });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Falta OPENAI_API_KEY en las variables de entorno.");

    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a ${nombre}, de género ${genero} y con fecha de nacimiento ${fechaNacimiento}, quien respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre los siguientes temas emocionales:

${temasValidos.join(", ")}

A continuación se presentan las respuestas al test (formato JSON por tema):
${JSON.stringify(respuestas, null, 2)}

El usuario también escribió este comentario libre:
"${comentarioLibre}"

Tu tarea es:

1. Analizar clínicamente las respuestas según criterios de escalas estandarizadas como:
   - PHQ-9 (depresión)
   - GAD-7 (ansiedad)
   - C-SSRS y Escala de desesperanza de Beck (riesgo suicida)
   - AUDIT y ASSIST (consumo de sustancias)
   - PSS (estrés)
   - Maslach Burnout Inventory (burnout)
   - SCL-90-R (evaluación general de síntomas)
   - Rosenberg (autoestima)
   - IAT (adicciones digitales)
   - PSQI (sueño)
   - Escala de soledad UCLA
   - Y-BOCS (TOC)

2. Vas a definir lo siguiente:

- "perfilEmocional": Una descripción profesional y detallada que resuma el estado emocional de la persona, redactado para un profesional de la salud o RRHH. Usa su nombre, género y edad estimada como contexto clínico.

- "SOS": Si detectas señales graves que requieran intervención inmediata por un profesional de salud mental, escribe exactamente "SOS". Si no, escribe "OK".

- "temaDetectado": Solo si escribiste "SOS", indica el tema emocional que detonó esa alerta.

Responde en formato JSON como este ejemplo:

{
  "perfilEmocional": "Texto aquí...",
  "SOS": "OK",
  "temaDetectado": ""
}
`.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    const completion = await response.json();
    console.log("🧠 Respuesta OpenAI cruda:", completion);

    const content = completion.choices?.[0]?.message?.content || "";

    let resultado;
    try {
      resultado = JSON.parse(content);
    } catch (err) {
      console.warn("⚠️ No se pudo parsear JSON. Se enviará texto en bruto.");
      resultado = {
        perfilEmocional: content,
        SOS: "OK",
        temaDetectado: ""
      };
    }

    // ✅ Registrar tokens
    try {
      const usage = completion.usage || {};
      const totalTokens = usage.total_tokens || 0;
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const costoUSD = totalTokens * 0.00001;

      await fetch("https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: new Date().toISOString(),
          usuario: correo,
          institucion,
          inputTokens,
          outputTokens,
          totalTokens,
          costoUSD: parseFloat(costoUSD.toFixed(6))
        })
      });
    } catch (err) {
      console.error("📉 Error al registrar tokens:", err);
    }

    return res.status(200).json(resultado);

  } catch (err) {
    console.error("🔥 Error crítico en analizar-test:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
