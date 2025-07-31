export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { tipoInstitucion } = req.body;
    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);

    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    // 📡 Obtener datos desde Apps Script
    const sheetResponse = await fetch("https://script.google.com/macros/s/AKfycbzlO8GCDMcnTFaT3jkH2zIii7q_rvtruV8ZLuuXLajBK-wO0MEI2VeJqAD_UuCzvIQHAQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const sheetData = await sheetResponse.json();
    console.log("📄 sheetData:", sheetData);

    if (!sheetData.ok) {
      return res.status(500).json({ ok: false, error: sheetData.error || "Error en Apps Script" });
    }

    const {
      usuario: correo,
      nombre,
      institucion,
      sexo: genero,
      fechaNacimiento,
      info,
      respuestas
    } = sheetData;

    console.log("📌 correo:", correo);
    console.log("📌 nombre:", nombre);
    console.log("📌 respuestas:", respuestas);

    if (!correo || !nombre || !respuestas || Object.keys(respuestas).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos: correo, nombre o respuestas vacías"
      });
    }

    const temasValidos = Object.keys(respuestas);
    const comentarioLibre = info || "";

    // ✅ PROMPT COMPLETO – NO MODIFICAR
    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a ${nombre}, de genero ${genero} y con fecha de nacimiento ${fechaNacimiento} y quien respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre los siguientes temas emocionales:

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
- Perfil emocional dirigido a un profesional de la salud y/o director de RRHH en donde expliques formal y profesionalmente, el perfil emocional de la persona. Utiliza su nombre, genero y edad como factores para crear este perfil y justifica tu análisis con el mayor detalle posible. 
- "sosDetectado": IMPORTANTÍSIMO: Siempre que detectes que alguno de los temas emocionales requiere atención inmediata de un experto en salud mental, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".
`.trim();

    console.log("🧠 Prompt generado:", prompt.slice(0, 500), "...");

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
        temperature: 0.7
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
      console.error("❌ No se pudo parsear JSON de OpenAI:", err);
      return res.status(500).json({ ok: false, error: "Formato inválido en la respuesta de OpenAI" });
    }

    const usage = data.usage || {};
    const costoUSD = usage.total_tokens ? usage.total_tokens * 0.00001 : 0;

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

    console.log("✅ JSON interpretado:", json);

    return res.status(200).json({
      ok: true,
      usuario: correo,
      nombre,
      institucion,
      tipoInstitucion,
      perfil: json.perfil || "",
      alertaSOS: json.alertaSOS || false,
      temaDetectado: json.temaDetectado || "",
      correoSOS: json.correoSOS || "",
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costoUSD: parseFloat(costoUSD.toFixed(6))
    });

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
