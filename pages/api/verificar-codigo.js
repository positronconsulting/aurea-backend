import { google } from 'googleapis';
import { getSecret } from 'wix-secrets-backend';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { codigo, email, yaRegistrado } = req.body;

    if (!codigo || !email) {
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: await getSecret("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        private_key: (await getSecret("GOOGLE_PRIVATE_KEY")).replace(/\\n/g, '\n')
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = await getSecret("SPREADSHEET_ID_TOKENS");
    const range = "CodigosInstitucion!A2:F"; // Incluye columna F (correo_sos)

    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const fila = data.values.find(row => row[0] === codigo);

    if (!fila) {
      return res.json({ acceso: false });
    }

    const nombreInstitucion = fila[1];
    const licenciasTotales = parseInt(fila[2]) || 0;
    const licenciasUsadas = parseInt(fila[3]) || 0;
    const activo = (fila[4] || "").toLowerCase() === "sí";
    const correoSOS = fila[5] || "";

    if (!activo) {
      return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    if (!yaRegistrado && licenciasUsadas >= licenciasTotales) {
      return res.json({ acceso: false, motivo: "Código inactivo o sin licencias" });
    }

    return res.json({
      acceso: true,
      institucion: nombreInstitucion,
      correoSOS: correoSOS
    });

  } catch (error) {
    console.error("Error en verificar-codigo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

