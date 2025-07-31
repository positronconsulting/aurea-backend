import fetch from 'node-fetch';

export async function sendWithService({ to, subject, body }) {
  try {
    const apiKey = process.env.SENDGRID_API_KEY;

    const emailData = {
      personalizations: [{
        to: Array.isArray(to)
          ? to.map(email => ({ email }))
          : [{ email: to }]
      }],
      from: {
        email: "alertas@positronconsulting.com",
        name: "Sistema AUREA"
      },
      subject,
      content: [{
        type: "text/plain",
        value: body
      }]
    };

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Error en envío SendGrid:", errorText);
      return { ok: false, error: errorText };
    }

    console.log("📨 Correo enviado con éxito");
    return { ok: true };
  } catch (err) {
    console.error("🔥 Error interno al enviar correo:", err);
    return { ok: false, error: err.message };
  }
}
