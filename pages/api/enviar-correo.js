import { sendEmail } from '../../utils/sendgrid';

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const {
      usuario,               // { nombre, correo } o string
      tipoInstitucion,
      perfil,
      alertaSOS,
      temaDetectado,
      correoSOS,

      // Opcionales desde analizar-test.js para máxima compatibilidad
      to,
      cc,
      bcc,
      extraDestinatarios
    } = req.body || {};

    const nombreUsuario = typeof usuario === "string"
      ? usuario
      : (usuario?.nombre || usuario?.correo || "Usuario");

    const correoUsuario = typeof usuario === "string"
      ? undefined
      : (usuario?.correo || "").trim();

    const asunto = alertaSOS
      ? `🚨 [AUREA - SOS] Evaluación crítica detectada (${nombreUsuario})`
      : `🧠 [AUREA] Perfil emocional generado (${nombreUsuario})`;

    const cuerpo = `
Hola,

Se ha generado el siguiente perfil emocional para el usuario ${nombreUsuario} (${tipoInstitucion}):

${perfil}

${alertaSOS
  ? `⚠️ Se detectó una posible alerta en el tema: ${temaDetectado}`
  : `✅ No se detectaron alertas críticas.`}

Atentamente,
Sistema AUREA
`.trim();

    // Construcción robusta de destinatarios
    const list = []
      .concat(
        Array.isArray(to) ? to : (to ? [to] : []),               // prioridad a 'to' si viene
        correoUsuario ? [correoUsuario] : [],                    // asegura usuario
        correoSOS ? [String(correoSOS).trim()] : [],            // asegura SOS
        "alfredo@positronconsulting.com",                        // asegura Alfredo
        Array.isArray(cc) ? cc : (cc ? [cc] : []),
        Array.isArray(bcc) ? bcc : (bcc ? [bcc] : []),
        Array.isArray(extraDestinatarios) ? extraDestinatarios : (extraDestinatarios ? [extraDestinatarios] : [])
      )
      .filter(Boolean)
      .map(s => String(s).trim().toLowerCase());

    // Deduplicar
    const destinatarios = Array.from(new Set(list));

    if (destinatarios.length === 0) {
      return res.status(400).json({ ok: false, error: "Sin destinatarios válidos" });
    }

    await sendEmail(destinatarios, asunto, cuerpo);

    return res.status(200).json({ ok: true, enviado: true, destinatarios });
  } catch (err) {
    console.error("❌ Error en enviar-correo.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno al enviar el correo" });
  }
}
