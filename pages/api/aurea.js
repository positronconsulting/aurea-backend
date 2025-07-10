export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      historial = [],
      nombre = "",
      institucion = "",
      tema = "",
      calificacionMasAlta = 0
    } = req.body;

    console.log("Data recibida en Aurea del backend:", {
      mensaje,
      historial,
      nombre,
      institucion,
      tema,
      calificacionMasAlta
    });

    if (!mensaje) {
      console.warn("⚠️ No se recibió mensaje");
      return res.status(400).json({ ok: false, error: "Mensaje vacío" });
    }

    const prompt = `
AUREA recibe el siguiente mensaje para prueba:
"${mensaje}"
`.trim();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("❌ No hay API Key de OpenAI en el entorno");
      return res.status(500).json({ ok: false, error: "Falta API Key" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Error de OpenAI:", errorText);
      return res.status(500).json({ ok: false, error: "Error al llamar a OpenAI", detalle: errorText });
    }

    const data = await response.json();
    const texto = data?.choices?.[0]?.message?.content || "Sin respuesta generada";

    console.log("✅ Respuesta de OpenAI:", texto);

    return res.status(200).json({ ok: true, respuesta: texto });

  } catch (error) {
    console.error("🔥 Error en aurea.js:", error);
    return res.status(500).json({ ok: false, error: "Error interno en el servidor" });
  }
}

