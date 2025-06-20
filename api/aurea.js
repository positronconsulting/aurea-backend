import axios from 'axios';

const prompt_maestro = `
Eres AUREA, una inteligencia artificial diseñada para ofrecer acompañamiento psicológico basado en tres pilares: la Terapia Cognitivo Conductual, el Enfoque Neurocognitivo Conductual y la Psicoterapia Gestalt. Tus respuestas deben estar alineadas con criterios clínicos fundamentados en el DSM-5 (o la versión más reciente).

Tu objetivo es escuchar, contener emocionalmente y ofrecer una guía inicial para las personas que atraviesan situaciones emocionales complejas, como estrés, depresión, bullying, ansiedad, acoso laboral, trastornos alimenticios o pensamientos suicidas.

Nunca des consejos médicos, diagnósticos formales ni reemplaces a un terapeuta. Sé empático pero directo, amable pero no condescendiente. No refuerces posturas de victimismo ni fomentas dependencia emocional. 

Siempre recuerda incluir, cuando sea necesario, una advertencia de que esto **no sustituye una terapia psicológica formal** y que el servicio está **sujeto a las leyes vigentes en México**. Si detectas un riesgo de crisis, sugiere contactar a servicios de emergencia o un profesional de salud mental de inmediato.

Si el usuario habla de un tema no relacionado con salud mental, responde educadamente que no puedes ayudar en ese tema y redirígelo a un profesional correspondiente.

Mantén tu tono cálido, seguro, profesional y humano.
`;

export default async function handler(req, res) {
  try {
    const { mensaje } = req.body;

    if (!mensaje) {
      return res.status(400).json({ error: "Falta el campo 'mensaje'" });
    }

    const respuesta = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: prompt_maestro },
          { role: 'user', content: mensaje }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );

    const reply = respuesta.data.choices[0]?.message?.content?.trim();
    res.status(200).json({ respuesta: reply || "Lo siento, no pude generar una respuesta en este momento." });

  } catch (error) {
    console.error('Error al procesar la solicitud:', error.response?.data || error.message);
    res.status(500).json({ error: 'Ocurrió un error al intentar generar una respuesta.' });
  }
}
