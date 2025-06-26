export default async function handler(req, res) {
  // Habilitar CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Responder a preflight
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { codigo, email, yaRegistrado } = req.body;

    if (!codigo || !email) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    const SHEET_ID = "1hES4WSal9RLQOX2xAyLM2PKC9WP07Oc48rP5wVjCqAE";
    const SHEET_NAME = "CodigosInstitucion";

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F?key=${API_KEY}`;

    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error("Error al conectar con Google Sheets");

    const data = await respuesta.json();
    const fila = data.values.find(row => row[0] === codigo);

    if (!fila) {
      return res.json({ acceso: false, motivo: "Código no encontrado" });
    }

    const [ , institucion, licTotStr, licUsadasStr, activoRaw ] = fila;
    const licenciasTotales = parseInt(licTotStr) || 0;
    const licenciasUsadas = parseInt(licUsadasStr) || 0;
    const activo = (activoRaw || "").toLowerCase() === "sí";

    if (!activo) {
      return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    if (!yaRegistrado && licenciasUsadas >= licenciasTotales) {
      return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    return res.json({ acceso: true, institucion });

  } catch (error) {
    console.error("🧨 Error en verificar-codigo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
