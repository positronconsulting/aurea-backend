import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const {
    mensajeUsuario,
    historial = [],
    nombre = "",
    correo = "",
    institucion = "",
    tipoInstitucion = "",
    temas = [],
    calificaciones = {}
  } = req.body;

  try {
    const mensajes = [
      {
        role: "system",
        content: `Eres un experto en salud mental que evalúa mensajes de personas con base en el DSM-5-TR, ICD-11, protocolos de Terapia Cognitivo Conductual (TCC), psicoterapia humanista y la guía WHO mhGAP.
        
Tu objetivo es analizar el mensaje recibido por parte del usuario y detectar sobre cuál de los siguientes temas está escribiendo:

${temas.join(", ")}

Cada tema es exclusivo de su tipo de institución. Debes elegir solo uno.

Luego, asigna una calificación del 1 al 10 sobre el bienestar emocional del usuario en ese tema, siendo 1 muy grave y 10 completamente saludable.

IMPORTANTE: Siempre que detectes en texto literal o en contexto señales de crisis emocional, suicidio, burnout, peligro físico o psicológico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, responde exactamente: "SOS" en el campo correspondiente.

Elige cuál sería la mejor pregunta conversacional para hacerle al usuario que ayude a confirmar o refinar tu calificación. Esa pregunta debe sonar como si fuera de un terapeuta humano y estar enmarcada en el enfoque TCC y humanista.

Devuelve tu análisis como un JSON con esta estructura estricta:

{
  "tema": "...",
  "nuevaCalificacion": ...,
  "certeza": ...,
  "preguntaSiguiente": "...",
  "justificacion": "...",
  "alerta": "SOS" | "OK"
}`
      },
      {
        role: "user",
        content: `
Nombre: ${nombre}
Correo: ${correo}
Institución: ${institucion}
Tipo de institución: ${tipoInstitucion}
Calificaciones actuales: ${JSON.stringify(calificaciones)}
Historial reciente: ${historial.join("\n")}
Nuevo mensaje del usuario: ${mensajeUsuario}`
      }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: mensajes,
      temperature: 0.4
    });

    const respuesta = completion.choices[0].message.content;

    let datos = {};
    try {
      datos = JSON.parse(respuesta);
    } catch (err) {
      return res.status(500).json({ error: "No se pudo interpretar la respuesta del modelo", detalle: respuesta });
    }

    const {
      tema = "sin_tema",
      nuevaCalificacion = null,
      certeza = 0,
      justificacion = "sin_justificacion",
      preguntaSiguiente = null,
      alerta = "OK"
    } = datos;

    const sos = alerta === "SOS";

    res.status(200).json({
      tema,
      nuevaCalificacion,
      certeza,
      justificacion,
      preguntaSiguiente,
      sos,
      raw: respuesta
    });

  } catch (error) {
    console.error("❌ Error en analizar-respuesta:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
}
