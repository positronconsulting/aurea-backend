// pages/api/aurea.js
// Centraliza logs: logCalificaciones (J=certeza/porcentaje, K=justificación),
// TemasInstitucion, ContarTema, Telemetría tokens. PROMPT ORIGINAL SIN CAMBIOS.

function allowCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token");
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// === GAS URLs (puedes sobreescribir por env) ===
const GAS_TELEMETRIA_URL = process.env.GAS_TELEMETRIA_URL
  || "https://script.google.com/macros/s/AKfycbyqV0EcaUb_o8c91zF4kJ7Spm2gX4ofSXcwGaN-_yzz14wgnuiNeGwILIQIKwfvzOSW1Q/exec"; // Telemetría

const GAS_LOG_CALIFICACIONES_URL = process.env.GAS_LOG_CALIFICACIONES_URL
  // Tu hoja: columnas A–K, J=certeza (num) y K=justificación (texto)
  || "https://script.google.com/macros/s/AKfycbyDdo0sgva6To9UaNQdKzhrSzF5967t2eA6YXi4cYJVgqeYRy7RJFHKhvhOE5vkBHkD_w/exec";

const GAS_TEMAS_INSTITUCION_URL = process.env.GAS_TEMAS_INSTITUCION_URL
  || "https://script.google.com/macros/s/AKfycbzJ1hbX6tMRA7qmd9JTRqDNQ9m46LBLqadXQu5Z87wfTeYrxhakC4vqoVtD9zHwwVy5bw/exec";

const GAS_CONTAR_TEMA_URL = process.env.GAS_CONTAR_TEMA_URL
  || "https://script.google.com/macros/s/AKfycbzAthTwYE4DRbGzEVxmEdd8rbaAl0SOpB9PnaOIRuOPL8DK_I8YTuPnKf6LQq9dSiG0/exec";

// === Helpers ===
async function postJSON(url, data, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
      signal: controller.signal
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, j, text };
  } finally { clearTimeout(t); }
}
function fireAndForget(url, data) {
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) })
    .catch(() => {});
}
function toInt01_100(x) {
  if (typeof x !== "number" || !isFinite(x)) return 0;
  if (x <= 1) return Math.max(0, Math.min(100, Math.round(x * 100)));
  return Math.max(0, Math.min(100, Math.round(x)));
}

export default async function handler(req, res) {
  allowCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      sexo,
      fechaNacimiento,
      calificaciones = {},  // perfil actual (11 temas -> 0..100)
      historial = [],
      sessionId = ""
    } = req.body || {};

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY no configurada" });
    }

    // ===================== PROMPT ORIGINAL (SIN CAMBIOS) =====================
    const prompt = `
Eres AUREA, psicóloga/neurocientífica experta en TCC y psicometría. Tu misión es acompañar RETANDO, no complaciendo y actualizar perfil emocional del usuario.
Reglas: 1) No trates temas fuera de misión; redirige. 2) Recomienda solo con evidencia.

Información del usuario:
- Nombre: ${nombre}
- Sexo: ${sexo}
- Fecha de nacimiento: ${fechaNacimiento}
- Institución: ${institucion}
- Perfil emocional actual que evalúa los 11 temas más influyentes en un ambiente (tipo: ${tipoInstitucion}), resultado de en un test con 43 reactivos basados en instrumentos base.
${Object.entries(calificaciones).map(([tema, cal]) => `- ${tema}: ${cal}`).join("\n")}

Historial de conversación emocional reciente:
${JSON.stringify(historial, null, 2)}

Nuevo mensaje del usuario:
"${mensaje}"

Esta es tu tarea:
1. Analiza el mensaje del usuario basándote en las palabras literales que indique, su perfil emocional actual, el DSM-5 y protocolos de TCC, y asígnalo a uno y solo uno de los temas de los 11 que presenta el perfil emocional del usuario. No inventes temas que no estén ahí y elige el que mejor se relacione con el mensaje del usuario por razones de psicología clínica, TCC y bases de neurociencia. NO te bases en clichés o estereotipos.
2. Utiliza los mismos criterios que en 1., los instrumentos base establecidos por la Institución y un criterio de psicometría basado en neurociencia (TCC, DSM-5, instrumentos base), para asignar una subcalificación que va a sustituir la que está en el perfil emocional actual por la del paso 2. Da la justificación clínica del instrumento o los instrumentos base en los que te apoyaste o el criterio que lo sostenga para evaluar la confiabilidad de la información.
3. Asigna una calificación entre 1 y 100 que reperesente qué tan probable es que el tema que seleccionas esté presente en el usuario y guárdala como la nueva calificación del tema seleccionado, sustituyendo la calificación que está en el perfil emocional actual por la del paso 2.
4. Vas a redactar un mensaje de no más de 1000 caracteres con el que vas a tener tres objetivos: 
a) cumplir con las reglas.
b) hacer sentir a la persona que está hablando con un profesional de la TCC con bases en neurociencia e instrumentos de la institución, usarás lenguaje de neurociencia con cuidado. Mantén y mejora el rapport. ACOMPAÑA una conversación, no des una guía. Tu objetivo es acompañar, apoyar y ayudar en la conversación y nunca empieces un mensaje con un saludo.
c) Incluye alguna pregunta basada en instrumentos y técnicas de TCC cuya respuesta te ayude a mejorar la certeza y acompañe.
5. IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales relacionadas con ideas suicidas, autolesiones, peligro personal, abuso sexual, violencia de género, ansiedad, depresión, peligro en casa, acoso, violencia de compañeros de clase, bullying, violencia intrafamiliar, TCA o similares, debes activar el Protocolo de Alerta y escribir exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Devuelve exclusivamente este objeto JSON. No agregues explicaciones ni texto adicional:

{
  "mensajeUsuario": "El mensaje que hayas definido bajo los criterios explicados",
  "temaDetectado": "Única y exclusivamente uno de estos temas: ${Object.keys(calificaciones).join(", ")}.",
  "calificacion": "La calificación entre 0 y 100 que hayas definido al tema seleccionado",
  "porcentaje": "Número entre 0 y 100 que representa qué tan confiable es la calificación que seleccionaste",
  "justificacion": "Texto corto que justifica la elección y la calificación basada en instrumentos y criterios clínicos",
  "SOS": "Escribe EXACTAMENTE 'OK' o 'SOS'"
}
    `.trim();
    // ================== FIN PROMPT ORIGINAL (SIN CAMBIOS) ===================

    // 1) Llamada a OpenAI con timeout
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 35000);
    let aiResp;
    try {
      aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 400
        }),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await aiResp.json();
    if (!data?.choices?.[0]?.message?.content) {
      return res.status(500).json({ ok: false, error: "Respuesta vacía de OpenAI" });
    }

    let json;
    try {
      json = JSON.parse(data.choices[0].message.content);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Formato inválido en la respuesta de OpenAI" });
    }

    // 2) Normalización de outputs esperados
    const temaDetectado = String(json.temaDetectado || "").trim();
    const calificacion = toInt01_100(Number(json.calificacion));
    const porcentaje = toInt01_100(Number(json.porcentaje)); // certeza 0..100 para Hoja J
    const justificacion = String(json.justificacion || "").trim();
    const SOS = String(json.SOS || "OK").toUpperCase() === "SOS" ? "SOS" : "OK";
    const mensajeUsuario = String(json.mensajeUsuario || "Gracias por compartir.");

    // 3) Telemetría de tokens (best-effort)
    const usage = data.usage || {};
    const costoUSD = usage.total_tokens ? usage.total_tokens * 0.00001 : 0;
    fireAndForget(GAS_TELEMETRIA_URL, {
      fecha: new Date().toISOString(),
      usuario: correo,
      institucion,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costoUSD: Number(costoUSD.toFixed(6)),
      sessionId
    });

    // 4) LOGS centrales (best-effort) — mapeo para tu Hoja:
    //    J = certeza (num 0–100) -> usamos "porcentaje"
    //    K = justificación (texto) -> usamos "justificacion"
    const calificacionAnterior = (temaDetectado && typeof calificaciones?.[temaDetectado] === "number")
      ? calificaciones[temaDetectado]
      : "";

    const payloadLog = {
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      mensajeUsuario: mensaje,
      tema: temaDetectado,
      calificacionAnterior,
      nuevaCalificacion: calificacion,
      certeza: porcentaje,            // ← Columna J
      justificacion: justificacion,   // ← Columna K
      fecha: new Date().toISOString(),
      sessionId
    };
    fireAndForget(GAS_LOG_
