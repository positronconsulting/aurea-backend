export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { tipoInstitucion } = req.body;

    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    // 📡 Obtener fila desde Apps Script
    const sheetResponse = await fetch("https://script.google.com/macros/s/AKfycbzlO8GCDMcnTFaT3jkH2zIii7q_rvtruV8ZLuuXLajBK-wO0MEI2VeJqAD_UuCzvIQHAQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    if (!sheetResponse.ok) {
      const fallbackText = await sheetResponse.text();
      console.error("❌ Apps Script no respondió correctamente:", fallbackText);
      return res.status(502).json({ ok: false, error: `Apps Script falló: ${fallbackText}` });
    }

    const sheetData = await sheetResponse.json();

    if (!sheetData.ok) {
      console.error("❌ Error lógico desde Apps Script:", sheetData.error);
      return res.status(500).json({ ok: false, error: sheetData.error });
    }

    console.log("✅ Datos recibidos desde Apps Script:", sheetData);

    const {
      usuario: correo,
      nombre,
      institucion,
      sexo: genero,
      fechaNacimiento,
      info,
      respuestas
    } = sheetData;

    if (!correo || !nombre || !respuestas || Object.keys(respuestas).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Faltan datos esenciales en la fila: correo, nombre o respuestas vacías."
      });
    }

    const temasValidos = Object.keys(respuestas);
    const comentarioLibre = info || "";

    // ✅ PROMPT (NO MODIFICAR SIN AUTORIZACIÓN)
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

    // 🔐 Llamada a OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Falta OPENAI_API_KEY");

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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

    const completion = await aiResponse.json();
    console.log("🧠 Respuesta OpenAI cruda:", completion);

    const content = completion.choices?.[0]?.message?.content || "";

    let data = {};
    try {
      data = JSON.parse(content);
    } catch (e) {
      console.error("⚠️ Error al parsear JSON:", e);
      data = {
        ok: true,
        error: true,
        mensaje: "No se pudo parsear como JSON. Se devuelve el contenido crudo generado por OpenAI.",
        raw: content
      };
    }

    // 📊 Registrar tokens
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

      console.log("📊 Tokens registrados correctamente.");
    } catch (err) {
      console.error("⚠️ Error al registrar tokens:", err);
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error("🧨 Error en analizar-test:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }

  // 🔒 Final fallback si nada más devolvió respuesta
  return res.status(500).json({ ok: false, error: "Respuesta vacía no controlada (final fallback)" });
}
