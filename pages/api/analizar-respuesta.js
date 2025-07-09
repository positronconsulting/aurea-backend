export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const {
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      calificaciones,
      mensajeUsuario,
      respuestaAurea
    } = req.body;

    console.log("📥 Datos recibidos para análisis:", req.body);

    // 👉 1. Construir prompt para OpenAI
    const prompt = `
Eres un sistema de análisis emocional que trabaja con base en DSM-5, ICD-11 y guías clínicas como TCC y mhGAP. Se te proporcionará:
- Nombre del usuario
- Tipo de institución
- Calificaciones actuales por tema (de 1 a 11)
- Último mensaje del usuario
- Última respuesta del sistema

Tu tarea es:
1. Detectar el tema emocional más relevante del mensaje del usuario dentro de los 11 temas que están calificados.
2. Asignar una nueva calificación (1-10) al tema detectado basándote en tests psicológicos como PHQ-9, GAD-7, C-SSRS, ASSIST y AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de soledad de UCLA, SCL-90-R, BAI y BDI-II o cualquier otro al que tengas acceso y creas que es el ideal.
3. Indicar el porcentaje de certeza (0-100%) de esa calificación.
4. Indica en qué test te basaste para la calificación y el porcentaje de certeza.
5. Proponer 2 preguntas para afinar el diagnóstico y obtener mayor certeza en futuras respuestas.

Entrega la respuesta en el siguiente formato JSON:
{
  "tema": "...",
  "nuevaCalificacion": 0,
  "certeza": 0,
  "justificación": "...",
  "pregunta1": "...",
  "pregunta2": "..."
}

Nombre: ${nombre}
Tipo de Institución: ${tipoInstitucion}
Calificaciones actuales: ${JSON.stringify(calificaciones)}
Mensaje del usuario: ${mensajeUsuario}
Respuesta del sistema: ${respuestaAurea}
`;

    // 👉 2. Consultar OpenAI
    const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const data = await openAIResponse.json();
    console.log("🧠 Respuesta OpenAI:", data);

    const content = data.choices?.[0]?.message?.content || "";
    const json = JSON.parse(content);
    const {
      tema,
      nuevaCalificacion,
      certeza,
      justificación,
      pregunta1,
      pregunta2
    } = json;

    // 👉 3. Guardar log en Google Sheets
    const logUrl = "https://script.google.com/macros/s/AKfycbyh1QuRv0byLuaEWxxKmPnz_qCwifTHNsGA-I9Kh_9saEAG76MJ06K2wDj_PWQqb0xkdg/exec";

    const logResponse = await fetch(logUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo,
        nombre,
        institucion,
        tipoInstitucion,
        tema,
        calificacionAnterior: calificaciones[tema] || "",
        nuevaCalificacion,
        certeza,
        justificación,
        pregunta1,
        pregunta2
      })
    });

    console.log("📊 Log en Sheets:", await logResponse.text());

    // 👉 4. Si certeza > 80, actualizar calificación en hoja de institución
    if (certeza >= 80) {
      const updateUrl = "https://script.google.com/macros/s/AKfycbxwyYwe7sal2eGb4nZeMv9qx_o2dkMO5iN6rpMfnmNjL3TYGuSAgvXqncL7u0kJH2mFJw/exec";

      const updateResponse = await fetch(updateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo,
          institucion,
          tipoInstitucion,
          tema,
          nuevaCalificacion,
          confirmado: "SI",
          fecha: new Date().toISOString()
        })
      });

      console.log("📈 Actualización calificación:", await updateResponse.text());
    }

    // 👉 5. Devolver al frontend
    return res.json({
      tema,
      nuevaCalificacion,
      certeza,
      justificación,
      pregunta1,
      pregunta2
    });

  } catch (error) {
    console.error("🧨 Error en analizar-respuesta:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
