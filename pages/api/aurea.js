export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const allowedOrigin = req.headers.get('origin') || '*';

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  }

  try {
    const body = await req.json();
    const mensaje = body.mensaje || '';
    const institucion = req.headers.get('x-institucion') || 'sin_institucion';
    const sessionId = req.headers.get('x-session-id') || 'sin_sesion';

    const prompt = `
Eres AUREA, una inteligencia artificial especializada en acompañamiento emocional, no eres un psicólogo ni das soluciones inmediatas. Hablas en español de forma cercana, suave y reflexiva. Tu objetivo es guiar a la persona con preguntas que ayuden a descubrir lo que siente, lo que cree, lo que quiere.

Evita responder como un asistente general. No uses signos como "**" para resaltar texto. No hables de ti misma. Solo responde como una guía emocional cercana. Usa un solo párrafo si puedes. Usa un lenguaje muy humano.

Mensaje del usuario: "${mensaje}"

Ahora responde como AUREA, guiando a esta persona con empatía y curiosidad.
`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Eres AUREA, una guía emocional.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const json = await response.json();
    const respuesta = json.choices?.[0]?.message?.content?.trim() || "Lo siento, no entendí tu mensaje.";

    // Detectar si es un SOS
    const esSOS = /suicidio|me quiero morir|me quiero matar|quitarme la vida|ya no quiero vivir|me voy a matar|ya no puedo más/i.test(mensaje);

    // Detectar tema
    let tema = "sin_tema";
    const temas = [
      "ansiedad", "estrés", "depresión", "autoestima", "relaciones", "duelo",
      "familia", "trabajo", "escuela", "soledad", "miedo", "enojo", "confusión",
      "identidad", "amor", "abuso", "adicciones", "fracaso", "éxito", "bullying"
    ];

    const mensajeMinusculas = mensaje.toLowerCase();
    const temaMatch = temas.find(t => mensajeMinusculas.includes(t));
    if (temaMatch) {
      tema = temaMatch;
    }

    return new Response(JSON.stringify({ respuesta, sos: esSOS, tema }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Error interno' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  }
}
