// /api/analizar-test.js (Vercel backend)

import { config } from "dotenv";
config();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { tipoInstitucion, correoSOS } = req.body;
    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);

    // 🔗 Apps Script URL para obtener respuestas
    const scriptUrl = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";

    const respuestaScript = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const textoPlano = await respuestaScript.text();
    let datos;
    try {
      datos = JSON.parse(textoPlano);
    } catch (err) {
      console.error("❌ Respuesta de Apps Script no es JSON válido:", textoPlano);
      return res.status(500).json({ ok: false, error: "Respuesta de Apps Script no es JSON válido" });
    }

    if (!datos.ok) {
      console.error("❌ Error lógico en datos recibidos:", datos.error);
      return res.status(500).json({ ok: false, error: datos.error });
    }

    const {
      usuario,
      sexo,
      fechaNacimiento,
      info,
      respuestas,
      hoja,
      fila
    } = datos;

    if (!usuario || !sexo || !fechaNacimiento || !respuestas) {
      console.error("❌ Datos incompletos del test");
      return res.status(500).json({ ok: false, error: "Datos incompletos del test" });
    }

    // 🧠 Consulta a OpenAI
    const prompt = generarPrompt({ respuestas, sexo, fechaNacimiento, info });

    const respuestaOpenAI = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const jsonOpenAI = await respuestaOpenAI.json();
    const perfil = jsonOpenAI.choices?.[0]?.message?.content?.trim();
    const inputTokens = jsonOpenAI.usage?.prompt_tokens || 0;
    const outputTokens = jsonOpenAI.usage?.completion_tokens || 0;
    const totalTokens = jsonOpenAI.usage?.total_tokens || 0;

    const alertaSOS = perfil?.includes("ALERTA SOS:");
    const temaDetectado = alertaSOS ? extraerTemaSOS(perfil) : "";

    // 📧 Envío de correo
    const asunto = alertaSOS
      ? `🛑 PERFIL CON ALERTA: ${usuario}`
      : `🧠 Nuevo perfil emocional generado: ${usuario}`;

    const cuerpo = `
Institución: ${tipoInstitucion}
Hoja: ${hoja}, fila ${fila}
Correo: ${usuario}
Sexo: ${sexo}
Fecha de nacimiento: ${fechaNacimiento}

${perfil}
    `.trim();

    const destinatarios = ["alfredo@positronconsulting.com"];
    if (correoSOS) destinatarios.push(correoSOS);

    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: destinatarios.map(email => ({ email })) }],
        from: { email: "alertas@positronconsulting.com", name: "Sistema AUREA" },
        subject: asunto,
        content: [{ type: "text/plain", value: cuerpo }]
      })
    });

    // 📊 Registrar tokens
    await fetch("https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha: new Date().toISOString(),
        usuario,
        institucion: tipoInstitucion,
        inputTokens,
        outputTokens,
        totalTokens,
        costoUSD: (totalTokens * 0.00001).toFixed(5)
      })
    });

    console.log("✅ Perfil emocional procesado y enviado exitosamente");
    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("🔥 Error en analizar-test.js:", error);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}

function generarPrompt({ respuestas, sexo, fechaNacimiento, info }) {
  return `Eres un psicólogo experto. Analiza el siguiente perfil emocional. Considera que el usuario es ${sexo}, nacido el ${fechaNacimiento}. Información adicional: ${info}.

Estas son sus respuestas:
${Object.entries(respuestas).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Genera un perfil emocional dirigido a especialistas. Si detectas una posible alerta grave, finaliza el texto con la línea:
ALERTA SOS: [tema relacionado].`;
}

function extraerTemaSOS(texto) {
  const match = texto.match(/ALERTA SOS: (.+)/);
  return match?.[1]?.trim() || "";
}
