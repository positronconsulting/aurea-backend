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

    console.log("📥 Data recibida en Aurea del backend:", {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion
    });

    // 🔐 OpenAI API
    const apiKey = process.env.OPENAI_API_KEY;

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Eres AUREA, una inteligencia artificial especializada en acompañamiento emocional. Responde de forma breve, cálida y empática."
          },
          {
            role: "user",
            content: mensaje
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      })
    });

    const data = await openAiResponse.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error("⚠️ Error en respuesta de OpenAI:", data);
      return res.status(500).json({ ok: false, error: "Error al procesar respuesta de AUREA" });
    }

    const respuestaAurea = data.choices[0].message.content.trim();

    console.log("🧠 Respuesta de AUREA:", respuestaAurea);

    return res.status(200).json({
      ok: true,
      respuesta: respuestaAurea
    });

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en aurea.js" });
  }
}
