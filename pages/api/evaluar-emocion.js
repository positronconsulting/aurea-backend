import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = '1hES4WSal9RLQOX2xAyLM2PKC9WP07Oc48rP5wVjCqAE'; 

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const {
      mensaje,
      historial,
      correo,
      institucion,
      tipoInstitucion,
      nombre,
      apellido
    } = await req.json();

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const hoja = tipoInstitucion === 'Empresa'
      ? 'Empresa'
      : tipoInstitucion === 'Educacion'
      ? 'Educacion'
      : 'Social';

    // Leer encabezados y datos
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${hoja}!A1:Z1000`,
    });

    const headers = data.values[0];
    let row = data.values.find((r) => r[1]?.toLowerCase() === correo?.toLowerCase());
    let rowIndex = data.values.findIndex((r) => r[1]?.toLowerCase() === correo?.toLowerCase());
    const fecha = new Date().toISOString().split("T")[0];

    // Si no existe, insertar con nombre completo y valores iniciales
    if (!row) {
      const temas = headers.slice(3, headers.length - 2);
      const nombreCompleto = `${nombre?.trim() || 'sin'} ${apellido?.trim() || 'nombre'}`.trim();

      const nuevaFila = [
        nombreCompleto,      // Nombre completo
        correo,              // Correo
        institucion,         // Institución
        ...temas.map(() => 0), // Calificaciones en 0
        "",                  // Notas
        fecha                // Última actualización
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${hoja}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [nuevaFila],
        },
      });

      row = nuevaFila;
      rowIndex = data.values.length; // nueva fila
    }

    const temas = headers.slice(3, headers.length - 2);
    const calificaciones = temas.map((t, i) => ({
      tema: t,
      valor: parseInt(row[i + 3]) || 0,
    }));

    const contexto = historial?.slice(-2).join('\n') || '';
    const prompt = `
Eres un sistema de análisis emocional. Evalúa el siguiente mensaje con palabras literales, contexto y calificaciones actuales.

Mensaje:
${mensaje}

Historial previo:
${contexto}

Temas emocionales:
${calificaciones.map(c => `${c.tema}: ${c.valor}`).join(', ')}

Tu tarea es:
1. Detectar el tema emocional principal.
2. Proponer una nueva calificación del 0 al 100 para ese tema basado en tests psicológicos como PHQ-9, GAD-7, C-SSRS, ASSIST y AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de soledad de UCLA, SCL-90-R, BAI y BDI-II.
3. Estimar tu % de certeza en esa asignación.
4. Sugerir 2 preguntas para confirmar o refinar ese diagnóstico.

Responde en JSON estricto:
{
  "tema": "nombre del tema",
  "calificacion": 0-100,
  "certeza": 0-100,
  "preguntas": ["...", "..."]
}
    `.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "system", content: prompt }],
        temperature: 0.4,
      }),
    });

    const respuesta = await openaiResponse.json();
    const jsonMatch = respuesta.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch?.[0] || '{}');

    const confirmado = result.certeza >= 80;

    // Registrar en PerfilAurea
    await fetch("https://www.positronconsulting.com/_functions/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo,
        institucion,
        tipoInstitucion,
        tema: result.tema,
        nuevaCalificacion: result.calificacion,
        confirmado,
        fecha,
      }),
    });

    // Si certeza ≥ 80%, actualizar en hoja
    if (confirmado) {
      const columna = headers.findIndex(h => h.toLowerCase() === result.tema.toLowerCase());
      if (columna !== -1) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${hoja}!${String.fromCharCode(65 + columna)}${rowIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[result.calificacion]],
          },
        });

        // Actualizar fecha
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${hoja}!${String.fromCharCode(65 + headers.length - 1)}${rowIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[fecha]],
          },
        });
      }
    }

    return new Response(JSON.stringify({
      tema: result.tema,
      calificacion: result.calificacion,
      certeza: result.certeza,
      preguntas: result.preguntas || []
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error("❌ Error en evaluar-emocion:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
