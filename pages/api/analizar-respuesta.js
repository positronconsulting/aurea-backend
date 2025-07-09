// ✅ Runtime explícito para evitar CORS
export const config = {
  runtime: 'nodejs'
};

export default async function handler(req, res) {
  console.log("📥 Petición recibida en analizar-respuesta");

  // ✅ CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader("Access-Control-Allow-Headers", "*");
    return res.status(200).end();
  }

  // ✅ Solo aceptar POST
  if (req.method !== "POST") {
    console.warn("❌ Método no permitido:", req.method);
    return res.status(405).json({ error: "Método no permitido" });
  }

  // ✅ Encabezados CORS para la respuesta
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const {
      mensaje,
      historial = [],
      nombre = "",
      correo = "",
      institucion = "",
      tipoInstitucion = "",
      temas = [],
      calificaciones = {}
    } = req.body;

    console.log("📨 Datos recibidos:", {
      mensaje,
      historial,
      nombre,
      correo,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones
    });

    if (!mensaje || !correo || !institucion) {
      console.error("❌ Faltan datos obligatorios");
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    const calificacionesLista = Object.entries(calificaciones)
      .map(([tema, valor]) => `${tema}: ${valor}/100`)
      .join("\n");

    const prompt = `
Eres un terapeuta con enfoque clínico y conocimientos en psicología basada en evidencia. Debes:

1. Analizar el siguiente mensaje de un usuario considerando el contexto de sus calificaciones psicológicas.
2. Asignar un tema principal emocional entre los siguientes: ${temas.join(", ")}.
3. Calificar su estado emocional del 1 al 100, usando tests como: PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, UCLA, SCL-90-R, BAI, BDI-II.
4. Dar una justificación breve.
5. Determinar si hay riesgo de crisis (SOS).
6. Si la certeza de la asignación es menor a 90%, genera una respuesta cálida, empática y reflexiva basada en TCC y Gestalt, que incluya una pregunta para profundizar en el proceso.

✉️ Mensaje: "${mensaje}"
👤 Nombre: ${nombre}
🏢 Institución: ${institucion}
📊 Calificaciones actuales:
${calificacionesLista}

🧠 Historial:
${historial.join("\n")}

🔁 Instrucciones de formato: Tu respuesta debe incluir un bloque de texto para el usuario, seguido de tres guiones (---) en una nueva línea, y luego:
- Tema principal
- Nueva calificación emocional
- Porcentaje de certeza
- Justificación breve
- SOS (true o false)
    `.trim();

    console.log("🧠 Enviando prompt a OpenAI...");
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      throw new Error("❌ No se encontró OPENAI_API_KEY en variables de entorno");
    }

    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.5,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const completionData = await completion.json();

    if (!completion.ok) {
      console.error("❌ Error en respuesta de OpenAI:", completionData);
      return res.status(500).json({ error: "Error al obtener respuesta de OpenAI", detalle: completionData });
    }

    const texto = completionData.choices?.[0]?.message?.content || "";
    console.log("✅ Respuesta recibida de OpenAI:");
    console.log(texto);

    const [bloque, metadatos] = texto.split("---").map(x => x.trim());

    const tema = metadatos?.match(/Tema principal\s*[:\-–]\s*(.+)/i)?.[1]?.toLowerCase() || "sin_tema";
    const nuevaCalificacion = parseInt(metadatos?.match(/Nueva calificación emocional\s*[:\-–]\s*(\d+)/i)?.[1]) || 0;
    const certeza = parseInt(metadatos?.match(/Porcentaje de certeza\s*[:\-–]\s*(\d+)/i)?.[1]) || 0;
    const justificacion = metadatos?.match(/Justificación\s*[:\-–]\s*(.+)/i)?.[1] || "";
    const sos = /sos\s*[:\-–]?\s*(true|sí|si)/i.test(metadatos);

    console.log("📊 Datos extraídos:");
    console.log({ tema, nuevaCalificacion, certeza, justificacion, sos });

    return res.status(200).json({
      respuesta: bloque,
      tema,
      nuevaCalificacion,
      certeza,
      justificacion,
      sos
    });

  } catch (error) {
    console.error("🔥 Error general en analizar-respuesta:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
}
