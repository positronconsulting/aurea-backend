// utils/sendgrid.js
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Envía un correo electrónico a los destinatarios especificados.
 * @param {string[]} to - Lista de correos.
 * @param {string} subject - Asunto del correo.
 * @param {string} text - Cuerpo del mensaje (texto plano).
 * @returns {Promise<object>} - Resultado del intento de envío.
 */
export async function sendEmail(to, subject, text) {
  try {
    const msg = {
      to,
      from: { email: 'alertas@positronconsulting.com', name: 'Sistema AUREA' },
      subject,
      text
    };

    const response = await sgMail.send(msg);
    console.log("📧 Correo enviado exitosamente:", response);
    return { ok: true, enviado: response };
  } catch (error) {
    console.error("❌ Error al enviar correo:", error);
    return { ok: false, error: error.message };
  }
}
