export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { codigo, email, yaRegistrado } = req.body;

    if (!codigo || !email) {
      console.log("❌ Faltan parámetros:", { codigo, email });
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    const SHEET_ID = "1hES4WSal9RLQOX2xAyLM2PKC9WP07Oc48rP5wVjCqAE";
    const SHEET_NAME = "CodigosInstitucion";

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}!A2:F?key=${API_KEY}`;
    console.log("🔗 Conectando a Google Sheets con URL:", url);

    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      const errorText = await respuesta.text();
      console.error("❌ Error al conectar con Google Sheets:", errorText);
      throw new Error("Error al conectar con Google Sheets");
    }

    const data = await respuesta.json();
    console.log("📄 Datos recibidos de Google Sheets:", data);

    const fila = data.values.find(row => row[0] === codigo);
    if (!fila) {
      console.log("⚠️ Código no encontrado en Google Sheets:", codigo);
      return res.json({ acceso: false, motivo: "Código no encontrado" });
    }

    const [ , institucion, activoRaw, licTotStr, licUsadasStr, correoSOS ] = fila;
    const licenciasTotales = parseInt(licTotStr) || 0;
    const licenciasUsadas = parseInt(licUsadasStr) || 0;
    const activo = (activoRaw || "").toLowerCase() === "sí";

    console.log("✅ Datos procesados:", { institucion, activo, licenciasTotales, licenciasUsadas, yaRegistrado });

    if (!activo) return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    if (!yaRegistrado && licenciasUsadas >= licenciasTotales) {
      return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    return res.json({ acceso: true, institucion, correoSOS });

  } catch (error) {
    console.error("🧨 Error en verificar-codigo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
