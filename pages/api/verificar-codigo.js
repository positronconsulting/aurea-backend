export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { codigo, yaRegistrado, intencionRegistro } = req.body;
    console.log("📥 Datos recibidos:", { codigo, yaRegistrado, intencionRegistro });

    if (!codigo) {
     console.warn("❌ Falta el código institucional.");
     return res.status(400).json({ error: "Falta el código institucional" });
    }


    const endpointAppsScript = "https://script.google.com/macros/s/AKfycbwdYtbQr_ipAomMRoPaxPdVy2fXbvLcaTw0uyXrZGrypcHVU3OEVEJA6m9W55_AvYsnTA/exec";

    console.log("📡 Llamando al Apps Script:", endpointAppsScript);

    const fetchBody = {
      codigo,
      email,
      yaRegistrado,
      intencionRegistro
    };
    console.log("📦 Payload enviado:", fetchBody);

    const respuesta = await fetch(endpointAppsScript, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fetchBody)
    });

    console.log("📬 Status respuesta:", respuesta.status, respuesta.statusText);

    const textoPlano = await respuesta.text();
    console.log("📨 Texto recibido (plano):", textoPlano);

    let resultado;
    try {
      resultado = JSON.parse(textoPlano);
      console.log("✅ JSON parseado:", resultado);
    } catch (errParse) {
      console.error("❌ No se pudo parsear el JSON:", errParse.message);
      return res.status(500).json({ error: "Respuesta no válida del verificador" });
    }

    if (!resultado || typeof resultado !== "object") {
      console.error("❌ Resultado malformado:", resultado);
      return res.status(500).json({ error: "Respuesta inválida del verificador" });
    }

    if (!resultado.acceso) {
      console.warn("🛑 Acceso denegado:", resultado.motivo || "sin motivo");
      return res.json({
        acceso: false,
        motivo: resultado.motivo || "Código inválido o sin acceso"
      });
    }

    console.log("✅ Respuesta final enviada:", resultado);
    return res.json({
      acceso: true,
      institucion: resultado.institucion || "sin nombre",
      correoSOS: resultado.correoSOS || "",
      tipoInstitucion: resultado.tipoInstitucion || "sin_tipo"
    });

  } catch (error) {
    console.error("🔥 Error en verificar-codigo general:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
