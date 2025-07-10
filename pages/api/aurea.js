export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const allowedOrigin = 'https://www.positronconsulting.com';

  if (req.method === 'OPTIONS') {
    // Manejo de preflight para CORS
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const mensaje = body?.mensaje || '';

      console.log("📥 Mensaje recibido:", mensaje);

      if (!mensaje) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Mensaje vacío"
        }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigin,
          }
        });
      }

      // 🔁 Respuesta simulada (prueba inicial)
      const respuesta = `Sí lo recibí: ${mensaje}`;

      return new Response(JSON.stringify({
        ok: true,
        respuesta
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        }
      });

    } catch (error) {
      console.error("🔥 Error interno:", error);
      return new Response(JSON.stringify({
        ok: false,
        error: "Error interno en el servidor"
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        }
      });
    }
  }

  return new Response(JSON.stringify({
    ok: false,
    error: "Método no permitido"
  }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
    }
  });
}
