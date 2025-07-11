import { OpenAI } from 'openai';
import { v4 as uuidv4 } from 'uuid';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      historial,
      temas,
      calificaciones,
      tema,
      calificacion,
      porcentaje
    } = req.body;

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Tu estilo es cercano, claro y humano a pesar de ser solo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

${nombre} mandó este mensaje: ${mensaje}, y este es el historial de la conversación: ${JSON.stringify(historial)}.

Analiza las palabras textuales y el contexto, como si fueras el mejor psicólogo del mundo, basándote en el DSM-5, protocolos de Terapia Cognitivo Conductual y relaciónalo con un tema de estos: ${temas.join(', ')}. Si no encuentras una relación directa, hazlo por análisis clínico al que más se acerque o al que podría relacionarse si tuvieras más información.

Utiliza el historial de mensajes, las calificaciones ${JSON.stringify(calificaciones)}, tema previo: ${tema}, porcentaje de certeza previo: ${porcentaje}, y los reactivos de tests psicológicos como el PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de Soledad UCLA, SCL-90-R, BAI o BDI-II para asignar una calificación al tema que seleccionaste y un porcentaje de certeza que tengas de esa calificación con la intención de ir formando un perfil psicológico del usuario.

Si el porcentaje de certeza que asignes es mayor a 90%, ofrécele un mensaje de acompañamiento. Si es menor a 90% incluye en tu mensaje de acompañamiento alguna pregunta cuya respuesta te ayude a llegar a un porcentaje de certeza del 100% sobre la calificación que asignaste.

IMPORTANTÍSIMO: Siempre que detectes que se muestran señales o que se usan palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia, violación, ludopatía o trastornos alimenticios, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Lo vas a escribir en formato JSON:
{
  "mensajeUsuario": "Aquí va el mensaje que le responderás al usuario",
  "temaDetectado": "Tema detectado entre los válidos",
  "calificacion": "Número del 1 al 100",
  "porcentaje": "Porcentaje de certeza del 1 al 100",
  "SOS": "SOS/OK"
}

Responde con ese JSON, sin explicación adicional.
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    console.log("🧠 Respuesta de OpenAI:", raw);

    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Error al parsear JSON:", err);
      return res.status(200).json({ ok: false, error: 'Respuesta inválida de OpenAI', raw });
    }

    // Calcular tokens
    const inputTokens = completion.usage?.prompt_tokens || 0;
    const outputTokens = completion.usage?.completion_tokens || 0;
    const totalTokens = completion.usage?.total_tokens || 0;
    const costoUSD = totalTokens * 0.00001;

    // Registrar tokens en Google Sheets
    await fetch("https://script.google.com/macros/s/AKfycbwA3XgsycDzaMJpUn-r9R0IRJdsSbmviY_lwN96w1b-lEwghaydhkDAkZaZUn5cQ3s3mQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionID: uuidv4(),
        usuario: correo,
        Institucion: institucion,
        inputTokens,
        outputTokens,
        totalTokens,
        costoUSD
      })
    });

    return res.status(200).json({ ok: true, ...json });

  } catch (error) {
    console.error("🔥 Error en handler aurea.js:", error);
    return res.status(500).json({ ok: false, error: 'Error interno en AUREA' });
  }
}


