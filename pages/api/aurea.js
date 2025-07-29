// pages/api/aurea.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje, correo, tipoInstitucion, nombre, institucion } = req.body;

    console.log("📥 Data recibida en Aurea:", {
      mensaje, correo, tipoInstitucion, nombre, institucion
    });

    const apiKey = process.env.OPENAI_API_KEY;

    const prompt = `
Eres AUREA, una inteligencia emocional empática, basada en la experiencia de los mejores psicólogos del mundo.

Una persona llamada ${nombre} (de ${institucion}, tipo: ${tipoInstitucion}) envió el siguiente mensaje:
"${mensaje}"

Tu misión es:
1. Escuchar sin juzgar
2. Contestar con una frase breve, cálida, empática y profesional
3. Detectar si hay señales de alerta emocional y etiquetarlas si existen

Devuelve ÚNICAMENTE este objeto JSON, sin explicaciones ni texto adicional:

{
  "mensajeUsuario": "Una respuesta cálida y emocional para el usuario",
  "temaDetectado": "Tema relevante detectado o vacío si no aplica",
  "calificacion": "Baja, Media o Alta",
  "porcentaje": "Número entero entre 0 y 100 que indica certeza emocional",
  "SOS": "OK" o "ALERTA"
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
        messages: [{ role: "user", content: prompt }],
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
      mensajeUsuario: json.mensajeUsuario || "🤖 Respuesta vacía.",
      temaDetectado: json.temaDetectado || "",
      calificacion: json.calificacion || "",
      porcentaje: json.porcentaje || "",
      SOS: json.SOS || "OK"
    });

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en AUREA" });
  }
}
