import { sendEmail } from '../../utils/sendgrid';


export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const { usuario, tipoInstitucion, perfil, alertaSOS, temaDetectado, correoSOS } = req.body;

    const asunto = alertaSOS
      ? `🚨 [AUREA - SOS] Evaluación crítica detectada (${usuario})`
      : `🧠 [AUREA] Perfil emocional generado (${usuario})`;

    const cuerpo = `
Hola,

Se ha generado el siguiente perfil emocional para el usuario ${usuario} (${tipoInstitucion}):

${perfil}

${alertaSOS
  ? `⚠️ Se detectó una posible alerta en el tema: ${temaDetectado}`
  : `✅ No se detectaron alertas críticas.`}

Atentamente,
Sistema AUREA
`.trim();

    const destinatarios = ["alfredo@positronconsulting.com"];
    if (correoSOS) destinatarios.push(correoSOS);

    await sendEmail(destinatarios, asunto, cuerpo);

    return res.status(200).json({ ok: true, enviado: true });
  } catch (err) {
    console.error("❌ Error en enviar-correo.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno al enviar el correo" });
  }
}
