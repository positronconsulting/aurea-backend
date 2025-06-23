export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { email, codigo } = req.body;

  if (!email || !codigo) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const respuesta = await fetch('https://script.google.com/macros/s/AKfycbxoLk1KxqGl_MVEU_2GoU5Da8fnx_frRaRfv9SCO2_yKI4HLQPO0F5AQKt6DVuf9k9XMw/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, codigo })
    });

    const resultado = await respuesta.json();

    return res.status(200).json(resultado);
  } catch (error) {
    console.error("Error al llamar a Apps Script:", error);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
}
