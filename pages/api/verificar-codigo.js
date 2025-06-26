export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { codigo, email, yaRegistrado } = req.body;

  if (!codigo || !email) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  // Parámetros específicos de tu configuración:
  const SHEET_ID = "1hES4WSal9RLQOX2xAyLM2PKC9WP07Oc48rP5wVjCqAE";
  const API_KEY = "AIzaSyBs1d09czmUB451Kr6V4ieadnI2JnpkJGk";
  const SHEET_NAME = "CodigosInstitucion";

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`;
    const response = await fetch(url);
    const result = await response.json();

    if (!result.values || result.values.length === 0) {
      return res.status(500).json({ error: "No se pudo leer la hoja" });
    }

    const headers = result.values[0];
    const rows = result.values.slice(1);

    const row = rows.find(r => r[0] === codigo);

    if (!row) {
      return res.json({ acceso: false });
    }

    const nombreInstitucion = row[1];
    const licenciasTotales = parseInt(row[2]) || 0;
    const licenciasUsadas = parseInt(row[3]) || 0;
    const activo = (row[4] || "").toLowerCase() === "sí";
    const correoSOS = row[5] || null;

    // 🔒 Si el código no está activo
    if (!activo) {
      return res.json({
        acceso: false,
        motivo: "Código inactivo o sin licencias"
      });
    }

    // 🔐 Si ya se usaron todas las licencias y es nuevo intento
    if (!yaRegistrado && licenciasUsadas >= licenciasTotales) {
      return res.json({
        acceso: false,
        motivo: "Código inactivo o sin licencias"
      });
    }

    // ✅ Todo correcto
    return res.json({
      acceso: true,
      institucion: nombreInstitucion,
      correoSOS
    });

  } catch (error) {
    console.error("❌ Error en conexión con Sheets:", error);
    return res.status(500).json({ error: "Error interno al leer las licencias" });
  }
}
