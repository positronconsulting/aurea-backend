// pages/api/aurea.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Preflight
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje, correo, tipoInstitucion, nombre, institucion } = req.body;

    console.log("📥 Data recibida en Aurea:", {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion
    });

    const apiKey = process.env.OPENAI_API_KEY;

    const prompt = `
${nombre} envió este mensaje: "${mensaje}".
Si fueras el mejor psicólogo del mundo, ¿qué le responderías?
Responde en formato JSON:
{
  "mensajeUsuario": "Tu respuesta cálida, breve y emocional"
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
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200
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
      respuesta: json.mensajeUsuario || "🤖 Respuesta vacía."
    });

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en AUREA" });
  }
}

