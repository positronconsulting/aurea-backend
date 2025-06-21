import { NextResponse } from 'next/server';

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(req) {
  try {
    const { prompt } = await req.json();

    // Aquí va tu lógica de conversación (OpenAI, respuesta, etc.)

    const respuesta = "Aquí iría tu respuesta procesada."; // solo ejemplo

    return new Response(JSON.stringify({ response: respuesta }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      },
    });
  }
}
