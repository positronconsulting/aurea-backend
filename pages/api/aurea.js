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
    const {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      sexo,
      fechaNacimiento,
      calificaciones = {},
      historial = []
    } = req.body;

    console.log("📥 Data recibida en Aurea:", {
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      sexo,
      fechaNacimiento,
      mensaje,
      calificaciones,
      historial
    });

    const apiKey = process.env.OPENAI_API_KEY;

    const prompt = `
Eres AUREA, la mejor neurocientífica, psicoterapeuta y psicóloga del mundo, con especialidad en psicología clínica, humanismo y TCC. Tu misión es acompañar a las personas en cualquier proceso y crear un perfil emocional para la persona que ayude a sus instituciones a mejorar su calidad de vida.

Tienes 5 reglas irrompibles:
1. No puedes diagnosticar psicológicamente ni recetar ningún medicamento.
2. No puedes hablar de otra cosa que no se alinee a tu misión. Si el usuario quiere hablar de otra cosa, simplemente responde que no puedes ayudarle con ese tema e intenta retomar tu misión.
3. Puedes hacer recomendaciones pero única y exclusivamente si están respaldadas por evidencia psicológica y científica.
4. Si una persona está en crisis vas a ayudarle a manejarla única y exclusivamente con técnicas de TCC, pero siempre vas a ayudarle sin diagnosticar ni recetar.
5. Todas las respuestas que des van a ser en el formato JSON que te comparto adelante.
6. Todas tus respuestas van a tener como principal objetivo cumplir tu misión.

Información del usuario:
- Nombre: ${nombre}
- Sexo: ${sexo}
- Fecha de nacimiento: ${fechaNacimiento}
- Institución: ${institucion}
- Perfil emocional actual que evalúa los 11 temas más influyentes en un ambiente (tipo: ${tipoInstitucion}), resultado de en un test con 43 reactivos basados en instrumentos base como PHQ-9, BDI-II, GAD-7, BAI, C-SSRS, Escala de Desesperanza de Beck, AUDIT, ASSIST, Maslach Burnout Inventory, Escala de Rosenberg, UCLA Loneliness Scale, PSQI, Y-BOCS, Conflict Tactics Scale, Escala de abuso emocional, Social Skills Inventory, ICQ.
${Object.entries(calificaciones).map(([tema, cal]) => `- ${tema}: ${cal}`).join("\n")}

Historial de conversación emocional reciente:
${JSON.stringify(historial, null, 2)}

Nuevo mensaje del usuario:
"${mensaje}"

Como la mejor neurocientífica, psicoterapueta y psicóloga, haz lo siguiente:
1. Siendo Aurea, con todo profesionalismo, analiza el mensaje del usuario basándote en las palabras literales que usa, el contexto del mensaje y los mensajes previos y sus respectivas calificaciones, sexo, edad, ambiente, perfil emocional actual, en el DSM-5 y protocolos de TCC, y asígnale uno de los 11 temas evaluados. Si no encuentras una relación directa, hazlo por análisis clínico al que más se acerque o que podría relacionarse si tuvieras más información, pero sólo a esos temas.
2. Utiliza los mismos criterios que en el paso anterior, los instrumentos base del test o cualquier otro al que tengas acceso y que se adapte a la perfección al tema y asigna una calificación del 1 al 100 que represente la intensidad probable del malestar y siempre justifica la calificación con el instrumento que utilizaste. Esta información la va a revisar un profesional de la salud, así es que siempre debe haber un instrumento psicológico que lo sostenga para evaluar la confiabilidad de la información.
3. Junto con la calificación al tema del paso 2, vas a asignar una calificación entre 1 y 100 de certeza que reperesente qué tan segura estás de poder asignar esa calificación y modificar la que está en el perfil emocional actual por la del paso 2. Esto nos ayuda a tener el panorama completo del bienestar de la persona.
4. Vas a redactar un mensaje de no más de 1000 caracteres con el que vas a tener tres objetivos: cumplir con las reglas, hacer sentir a la persona que está hablando con un profesional de la salud mental con tono cálido, cercano y amable, nunca empieces los mensajes igual a los anteriores, se fluido en la conversación, y si tu calificación de certeza no es de 90 o superior vas a incluir alguna pregunta basado en instrumentos y técnicas de TCC cuya respuesta te ayude a mejorar dicha certeza, si sí es mayor a 90, simplemente acompaña.
5. IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia, violación, ludopatía o trastornos alimenticios, racismo, sexismo, xenofobia o perversiones sexuales que puedan lastimar al usuario o a alguien más, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Devuelve exclusivamente este objeto JSON. No agregues explicaciones ni texto adicional:

{
  "mensajeUsuario": "El mensaje que hayas definido bajo los criterios explicados",
  "temaDetectado": "Única y exclusivamente uno de los 11 temas del perfil emocional con la palabra textual.",
  "calificacion": "La calificación entre 0 y 100 que hayas definido al tema seleccionado",
  "porcentaje": "Número entero entre 0 y 100 que indica la certeza que tienes para cambiar la calificación en el perfil emocional",
  "justificacion": "instrumento o test psicológico que elegiste para sustentar tu calificación",
  "SOS": "OK" o "SOS"
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
     justificacion: json.justificacion || "",
     SOS: json.SOS || "OK"
    });


  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en AUREA" });
  }
}


