export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Método no permitido'
    }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      }
    });
  }

  try {
    const body = await req.json();
    const mensaje = body?.mensaje || "";

    console.log("📥 Recibido en AUREA.js:", mensaje);

    return new Response(JSON.stringify({
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje}`
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      }
    });

  } catch (error) {
    console.error("🔥 Error en parsing JSON:", error.message);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Error procesando JSON en el servidor'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      }
    });
  }
}
