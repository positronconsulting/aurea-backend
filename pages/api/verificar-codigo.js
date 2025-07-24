export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { codigo, email, yaRegistrado, intencionRegistro } = req.body;

    console.log("📥 Datos recibidos en verificar-codigo:", {
      codigo,
      email,
      yaRegistrado,
      intencionRegistro
    });

    if (!codigo || !email) {
      console.warn("❌ Faltan parámetros obligatorios:", { codigo, email });
      return res.status(400).json({ error: "Faltan parámetros" });
    }

    const endpointAppsScript = "https://script.google.com/macros/s/AKfycbwdYtbQr_ipAomMRoPaxPdVy2fXbvLcaTw0uyXrZGrypcHVU3OEVEJA6m9W55_AvYsnTA/exec";
    console.log("📡 Llamando al Apps Script:", endpointAppsScript);

    const respuesta = await fetch(endpointAppsScript, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, email, yaRegistrado, intencionRegistro })
    });

    console.log("📬 Status respuesta:", respuesta.status, respuesta.statusText);

    const textoPlano = await respuesta.text();
    console.log("📨 Texto recibido:", textoPlano);

    let resultado;
    try {
      resultado = JSON.parse(textoPlano);
    } catch (e) {
      console.error("❌ No se pudo parsear JSON:", e.message);
      return res.status(500).json({ error: "Respuesta no válida del verificador" });
    }

    if (!resultado || typeof resultado !== "object") {
      console.error("❌ Respuesta vacía o malformada:", resultado);
      return res.status(500).json({ error: "Respuesta inválida del verificador" });
    }

    if (!resultado.acceso) {
      console.warn("🛑 Acceso denegado:", resultado.motivo || "sin motivo");
      return res.json({
        acceso: false,
        motivo: resultado.motivo || "Código inválido o sin acceso"
      });
    }

    // ✅ Si todo salió bien, responde al frontend
    console.log("✅ Acceso permitido. Enviando respuesta final:", resultado);

    return res.json({
      acceso: true,
      institucion: resultado.institucion || "sin nombre",
      correoSOS: resultado.correoSOS || "",
      tipoInstitucion: resultado.tipoInstitucion || "sin_tipo"
    });

  } catch (error) {
    console.error("🔥 Error en verificar-codigo:", error.message);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}

