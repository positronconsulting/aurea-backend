export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { tipoInstitucion, correoSOS } = req.body || {};

    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);

    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    // 1. Obtener datos desde Apps Script
    const response = await fetch("https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const raw = await response.text();
    let datos;

    try {
      datos = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Respuesta de Apps Script no es JSON válido:", raw);
      return res.status(500).json({ ok: false, error: "Respuesta de Apps Script no es JSON válido" });
    }

    if (!datos.ok) {
      return res.status(500).json({ ok: false, error: datos.error || "Error lógico en Apps Script" });
    }

    const {
      usuario,
      sexo,
      fechaNacimiento,
      info,
      respuestas
    } = datos;

    // 2. Enviar a OpenAI para análisis
    const prompt = `
Eres AUREA, la mejor psicóloga clínica de Latinoamérica y especialista en intervención de crisis y apoyo emocional. 
Recibirás una serie de respuestas a preguntas sensibles con el objetivo de crear un perfil emocional de la persona que respondió. 
Tu objetivo es generar un perfil clínico profesional, compasivo y útil para especialistas que brindan apoyo psicológico.

No repitas las preguntas, no des formato JSON. Redacta el perfil como un informe clínico conciso, claro y profesional.

A continuación se presentan las respuestas al test:
${Object.entries(respuestas).map(([pregunta, respuesta]) => `- ${pregunta}: ${respuesta}`).join('\n')}
    `.trim();

    const apiKey = process.env.OPENAI_API_KEY;

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const aiData = await aiResponse.json();

    if (!aiData.choices || !aiData.choices[0]) {
      return res.status(500).json({ ok: false, error: "No se pudo obtener respuesta de OpenAI" });
    }

    const perfil = aiData.choices[0].message.content;
    const usage = aiData.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || inputTokens + outputTokens;
    const costoUSD = totalTokens * 0.01 / 1000;

    // 3. Enviar correo
    await fetch("https://www.positronconsulting.com/_functions/enviarCorreoPerfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correoUsuario: usuario,
        nombre: usuario,
        institucion: tipoInstitucion,
        tipoInstitucion,
        perfil,
        alertaSOS: false, // Puedes detectar esto con lógica adicional si deseas
        temaDetectado: "",
        correoSOS
      })
    });

    // 4. Registrar tokens
    await fetch("https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString(),
        usuario,
        institucion: tipoInstitucion,
        inputTokens,
        outputTokens,
        totalTokens,
        costoUSD
      })
    });

    console.log("✅ Proceso de análisis completo");
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("🔥 Error interno en analizar-test.js:", error);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}

