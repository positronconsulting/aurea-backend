export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // preflight
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { email, codigo, yaRegistrado } = req.body;

  if (!email || !codigo) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  // 🔄 NUEVO: consultar SIEMPRE si el código está activo en Google Sheets
  try {
    const respuesta = await fetch('https://script.google.com/macros/s/AKfycbxoLk1KxqGl_MVEU_2GoU5Da8fnx_frRaRfv9SCO2_yKI4HLQPO0F5AQKt6DVuf9k9XMw/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, codigo })
    });

    const resultado = await respuesta.json();

    // Si no está activo o no hay licencias, bloquear acceso
    if (!resultado.acceso) {
      return res.status(403).json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    // Si ya está registrado, pero sigue activo
    if (yaRegistrado) {
      return res.status(200).json({
        acceso: true,
        institucion: resultado.institucion || "desconocida"
      });
    }

    // Si es nuevo y válido, continuar normalmente
    return res.status(200).json(resultado);

  } catch (error) {
    console.error("Error al llamar a Apps Script:", error);
    return res.status(500).json({ error: 'Error en el servidor' });
  }
}
