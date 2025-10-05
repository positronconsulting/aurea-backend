// pages/api/aurea.js
// Logs: logCalificaciones (J=porcentaje/certeza, K=justificación),
// TemasInstitucion, ContarTema y TOKENS (registrarTokens.gs, fire-and-forget).
// PROMPT ORIGINAL SIN CAMBIOS.

function allowCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN || "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token");
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// === GAS URLs (puedes sobreescribir por env) ===
const GAS_LOG_CALIFICACIONES_URL = process.env.GAS_LOG_CALIFICACIONES_URL
  || "https://script.google.com/macros/s/AKfycbyDdo0sgva6To9UaNQdKzhrSzF5967t2eA6YXi4cYJVgqeYRy7RJFHKhvhOE5vkBHkD_w/exec";

const GAS_TEMAS_INSTITUCION_URL = process.env.GAS_TEMAS_INSTITUCION_URL
  || "https://script.google.com/macros/s/AKfycbzJ1hbX6tMRA7qmd9JTRqDNQ9m46LBLqadXQu5Z87wfTeYrxhakC4vqoVtD9zHwwVy5bw/exec";

const GAS_CONTAR_TEMA_URL = process.env.GAS_CONTAR_TEMA_URL
  || "https://script.google.com/macros/s/AKfycbzAthTwYE4DRbGzEVxmEdd8rbaAl0SOpB9PnaOIRuOPL8DK_I8YTuPnKf6LQq9dSiG0/exec";

//⬇️ Tu Web App para tokens (registrarTokens.gs)
const GAS_TOKENS_URL = process.env.GAS_TOKENS_URL
  || "https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec";

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
      calificaciones = {},
      historial = [],
      sessionId = ""
    } = req.body || {};

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY no configurada" });
    }

    // ===================== PROMPT ORIGINAL (SIN CAMBIOS) =====================
    const prompt = `
Eres AUREA, psicóloga/neurocientífica la mayor experta a nivel mundial en TCC, Neurociencia y psicometría. Tu misión es acompañar RETANDO, no complaciendo y actualizar perfil emocional del usuario.
Reglas: 1) No trates temas fuera de misión; redirige. 2) Recomienda solo con evidencia.

Información del usuario:
- Nombre: ${nombre}
- Sexo: ${sexo}
- Fecha de nacimiento: ${fechaNacimiento}
- Institución: ${institucion}
- Perfil emocional actual que evalúa los 11 temas más influyentes en un ambiente (tipo: ${tipoInstitucion})
${Object.entries(calificaciones).map(([tema, cal]) => `- ${tema}: ${cal}`).join("\n")}

Historial de conversación emocional reciente:
${JSON.stringify(historial, null, 2)}

Nuevo mensaje del usuario:
"${mensaje}"

Esta es la tarea que debes cumplir como AUREA:
1. Analiza el mensaje del usuario basándote en: palabras literales, contexto, perfil emocional, edad, institución, DSM-5, protocolos de TCC y nuerocientíficos.
2. Elige a cuál de estos temas se relaciona más el mensaje: ${Object.keys(calificaciones).join(", ")}. No inventes ni agregues temas. Elige sólo 1.
3. Define una calificación de 0 a 100 que represente el nivel de malestar o bienestar emocional del usuario en el tema elegido. Justifícala con algún instrumento psicológico institucional para darle certeza a la información.
4. Define una calificación de 0 a 100 que defina qué tan segura estás de la calificación del número 4.
5. Redacta una respuesta de no más de 1000 caracteres que acompañe al usuario. Hazlo como AUREA. Dale seguimiento a la conversación con el historial de conversación, genera rapport y nunca empieces un mensaje con un saludo. Si necesitas preguntar algo para poder aumentar tu calificación de certeza, agrégala, pero siempre siguiendo los protocolos de TCC y Neurociencias.
6. IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales relacionadas con ideas suicidas u obsesivas, adicciones a sustancias ilegales, autolesiones, abuso sexual, violencia de género, ansiedad o depresión extrema, violencia física o psicológica, acoso, bullying, violencia intrafamiliar, TCA o ludopatía debes activar el Protocolo de Alerta y escribir exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Devuelve exclusivamente este objeto JSON. No agregues explicaciones ni texto adicional:

{
  "mensajeUsuario": "respuesta para el usuario",
  "temaDetectado": "tema elegido",
  "calificacion": "calificación entre 0 y 100 que hayas definido al tema seleccionado",
  "porcentaje": "Número entre 0 y 100 que representa qué tan segura estás de la calificación que definiste",
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
    const porcentaje = toInt01_100(Number(json.porcentaje)); // certeza 0..100 -> Hoja J
    const justificacion = String(json.justificacion || "").trim();
    const SOS = String(json.SOS || "OK").toUpperCase() === "SOS" ? "SOS" : "OK";
    const mensajeUsuario = String(json.mensajeUsuario || "Gracias por compartir.");

    // 3) Registrar TOKENS (registrarTokens.gs) — FIRE-AND-FORGET (sin esperar)
    const usage = data.usage || {};
    const costoUSD = usage.total_tokens ? usage.total_tokens * 0.00001 : 0;
    const tokensPayload = {
      fecha: new Date().toISOString(),
      usuario: correo,
      institucion,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costoUSD: Number(costoUSD.toFixed(6))
    };
    // Enviamos sin await para evitar falsos timeouts en logs
    postJSON(GAS_TOKENS_URL, tokensPayload, 7000)
      .then(r => { console.log("Tokens GAS (ff):", r?.status, r?.j || r?.text); })
      .catch(() => { /* no ruido si tarda o falla */ });

    // 4) LOGS críticos (espera corta) — en paralelo
    const calificacionAnterior = (temaDetectado && typeof calificaciones?.[temaDetectado] === "number")
      ? calificaciones[temaDetectado]
      : "";

    const logCalifPayload = {
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
      fecha: new Date().toISOString()
    };

    await Promise.allSettled([
      postJSON(GAS_LOG_CALIFICACIONES_URL, logCalifPayload, 4000),
      temaDetectado ? postJSON(GAS_TEMAS_INSTITUCION_URL, { institucion, tema: temaDetectado }, 4000) : Promise.resolve({ ok: true }),
      temaDetectado ? postJSON(GAS_CONTAR_TEMA_URL, { correo, tema: temaDetectado, evento: "mensaje", valor: 1, extra: { institucion } }, 4000) : Promise.resolve({ ok: true })
    ]);

    // 5) Respuesta al orquestador/FE
    return res.status(200).json({
      ok: true,
      mensajeUsuario,
      temaDetectado,
      calificacion,
      porcentaje,
      justificacion,
      SOS,
      perfilSugerido: (temaDetectado ? { [temaDetectado]: calificacion } : {})
    });

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en AUREA" });
  }
}


