export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { codigo, email, yaRegistrado } = req.body;

    console.log("📥 Datos recibidos:", { codigo, email, yaRegistrado });

    if (!codigo || !email) {
      console.log("❌ Faltan parámetros:", { codigo, email });
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const endpointAppsScript = "https://script.google.com/macros/s/AKfycbytnZWhbWF5Zz6IbT7_ModkYNDYxCW7YchbsbtypRfQnUAr1zyez9GOXq8SqeuvlrH9fA/exec";

    console.log("📨 Enviando al Apps Script:", endpointAppsScript);

    const respuesta = await fetch(endpointAppsScript, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, email, yaRegistrado })
    });

    console.log("📬 Respuesta recibida:", respuesta.status, respuesta.statusText);

    if (!respuesta.ok) {
      const errorText = await respuesta.text();
      console.error("❌ Error al conectar con Google Apps Script:", errorText);
      throw new Error("Error al conectar con el verificador");
    }

    const resultado = await respuesta.json();
    console.log("🔒 Resultado desde Apps Script:", resultado);

    if (!resultado.acceso) {
      return res.json({
        acceso: false,
        motivo: resultado.motivo || "Código inválido o sin acceso"
      });
    }

    return res.json({
      acceso: true,
      institucion: resultado.institucion || "sin nombre",
      correoSOS: resultado.correoSOS || "",
      tipoInstitucion: resultado.tipoInstitucion || "sin_tipo"
    });

  } catch (error) {
    console.error("🧨 Error en verificar-codigo:", error.message);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}


