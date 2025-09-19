// pages/api/analizar-test.js
export default async function handler(req, res) {
  // ── CORS ───────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok:false, error:"Method Not Allowed" });
  }

  // ── Token interno (lo envía el worker) ─────────────────────────────────────
  const expected = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
  const got = String(req.headers["x-internal-token"] || "").trim();

  // Logs cortos para diagnóstico
  if (process.env.NODE_ENV !== "production") {
    console.log("[analizar-test] expected.len:", expected.length);
    console.log("[analizar-test] got.len     :", got.length);
    console.log("[analizar-test] got.prefix  :", got.slice(0, 5));
  }

  if (!expected || got !== expected) {
    return res.status(401).json({ ok:false, error:"Unauthorized" });
  }

  // ── CONFIG ─────────────────────────────────────────────────────────────────
  const GAS_RESP_URL      = "https://script.google.com/macros/s/AKfycbwOlx381TjxulLqMS0sSfgmqoQjWf_XopINzbuxy3zNw5EMXkKaO9CYGrYdyrh5iOi1ig/exec";
  const GAS_VERUSER_URL   = "https://script.google.com/macros/s/AKfycbxfzxX_s97kIU4qv6M0dcaNrPIRxGDqECpd-uvoi5BDPVaIOY5ybWiVFiwqUss81Y-oNQ/exec";
  const API_ENVIAR_CORREO = "https://aurea-backend-two.vercel.app/api/enviar-correo";

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const inval = (v) => {
    const s = (v==null ? "" : String(v)).trim().toLowerCase();
    return s === "" || s === "none" || s === "null" || s === "undefined" || s === "n/a";
  };

  async function postJSON(url, data, ms = 12000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
        signal: controller.signal
      });
      const text = await r.text();
      let j=null; try{ j=JSON.parse(text); } catch(_){}
      return { okHTTP: r.ok, j, text, status: r.status };
    } finally {
      clearTimeout(t);
    }
  }

  try {
    const { tipoInstitucion, email, correoSOS, codigo } = (req.body || {});
    if (!tipoInstitucion) {
      return res.status(400).json({ ok:false, error:"tipoInstitucion requerido" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok:false, error:"Falta OPENAI_API_KEY" });
    }

    const tipo = String(tipoInstitucion || "").trim().toLowerCase();

    // 1) GAS: obtener fila pendiente (o por email) con reintentos
    async function obtenerFila() {
      const payload = {
        tipoInstitucion,
        email,
        correoSOS,
        codigo,
        jobId: `${email}-${Date.now()}`,           // 👈 trazabilidad
        requestedAt: new Date().toISOString()      // 👈 auditoría
      };

      if (email) payload.email = String(email).toLowerCase();
      const backoffs = [0, 1500, 3000];
      let last = null;
      for (let i=0;i<backoffs.length;i++){
        if (backoffs[i]) await sleep(backoffs[i]);
        last = await postJSON(GAS_RESP_URL, payload, 12000);
        if (last?.j?.ok) return last;
      }
      return last;
    }

    const g = await obtenerFila();
    if (!g?.j?.ok) {
      return res.status(200).json({
        ok: false,
        stage: "GAS",
        error: g?.j?.error || g?.text || "GAS sin pendiente",
        detail: { tipo, email: email || "", codigo: codigo || "" }
      });
    }

    const correoUsuario = String(g.j.usuario || "").toLowerCase();
    let nombre = g.j.nombre || "";
    const sexo = g.j.sexo || "";
    const fechaNacimiento = g.j.fechaNacimiento || "";
    const respuestas = g.j.respuestas || {};
    const comentarioLibre = inval(g.j.info) ? "" : String(g.j.info).trim();

    // 2) Enriquecer nombre desde Usuarios (si falta)
    if (!nombre && correoUsuario) {
      try {
        const r = await postJSON(GAS_VERUSER_URL, { correo: correoUsuario, codigo: codigo || "" }, 10000);
        const usr = r?.j?.usuario;
        if (usr && (usr.nombre || usr.apellido)) {
          nombre = [usr.nombre||"", usr.apellido||""].join(" ").trim();
        }
      } catch(_) {}
      if (!nombre) nombre = correoUsuario.split("@")[0];
    }

    // 3) PROMPT
    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a ${nombre}, de genero ${sexo} y con fecha de nacimiento ${fechaNacimiento}, quien respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre diversos temas emocionales.

A continuación se presentan las respuestas al test (formato JSON):
${JSON.stringify(respuestas, null, 2)}

El usuario también escribió este comentario libre:
"${comentarioLibre}"

Tu tarea es:

1. Analizar clínicamente las respuestas según criterios de escalas estandarizadas como:
   - PHQ-9 (depresión)
   - GAD-7 (ansiedad)
   - C-SSRS y Escala de desesperanza de Beck (riesgo suicida)
   - AUDIT y ASSIST (consumo de sustancias)
   - PSS (estrés)
   - Maslach Burnout Inventory (burnout)
   - SCL-90-R (evaluación general de síntomas)
   - Rosenberg (autoestima)
   - IAT (adicciones digitales)
   - PSQI (sueño)
   - Escala de soledad UCLA
   - Y-BOCS (TOC)

2. Vas a definir lo siguiente:
- "perfil": Un texto profesional dirigido a un psicólogo clínico o director de RRHH que explique el perfil emocional de la persona. Utiliza su nombre, género y edad para contextualizar y justifica tu análisis con el mayor detalle posible.
- "alertaSOS": true si hay riesgo emocional urgente que requiere atención inmediata por un profesional. Si no lo hay, false.
- "temaDetectado": si hay alertaSOS, indica el tema que más contribuye a la alerta. Si no la hay, deja vacío o null.

Es de suma importancia que devuelvas exclusivamente un objeto JSON. No agregues explicaciones ni encabezados. NO INCLUYAS ningún texto antes o después. Única y exclusivamente el JSON en el siguiente formato:
{
  "perfil": "Texto del perfil emocional...",
  "alertaSOS": true | false,
  "temaDetectado": "Solo si hay alertaSOS"
}
`.trim();

    async function pedirOpenAI() {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini", // usa el modelo que prefieras disponible en tu cuenta
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 800
        })
      });
      const j = await r.json();
      const content = j?.choices?.[0]?.message?.content || "";
      let out;
      try { out = JSON.parse(content); }
      catch { out = { perfil: content, alertaSOS: false, temaDetectado: "" }; }
      return { completion: j, out };
    }

    const valido = (s) => !inval(s) && String(s).trim().length >= 50;

    // 4) OpenAI con validación y reintento
    let resultado = null;
    for (let intento = 0; intento < 2; intento++) {
      const { out } = await pedirOpenAI();
      const perfil = out?.perfil || "";
      if (valido(perfil)) {
        resultado = { perfil, sos: !!out?.alertaSOS, tema: out?.temaDetectado || "" };
        break;
      }
      await sleep(600);
    }

    if (!resultado) {
      return res.status(200).json({
        ok: false,
        stage: "OPENAI",
        error: "Perfil vacío/None/corto tras reintento",
        detail: { tipo, email: email||"", codigo: codigo||"", correoUsuario }
      });
    }

    // 5) Enviar correo (usuario + SOS + Alfredo)
    const destinatarios = [
      correoUsuario,
      (correoSOS || "").trim(),
      "alfredo@positronconsulting.com"
    ].filter(Boolean);

    async function enviarCorreo(payload) {
      for (let i=0;i<2;i++){
        const r = await postJSON(API_ENVIAR_CORREO, payload, 12000);
        if (r?.okHTTP && r?.j?.ok) return { ok: true };
        await sleep(800);
      }
      return { ok:false };
    }

    const envio = await enviarCorreo({
      usuario: { nombre, correo: correoUsuario },
      tipoInstitucion: tipo,
      perfil: resultado.perfil,
      alertaSOS: !!resultado.sos,
      temaDetectado: resultado.tema,
      correoSOS: correoSOS || "",
      to: [correoUsuario],
      cc: destinatarios.filter(d => d !== correoUsuario),
      bcc: [],
      extraDestinatarios: destinatarios
    });

    if (!envio.ok) {
      return res.status(200).json({
        ok: false,
        stage: "SENDMAIL",
        error: "Fallo al enviar correo",
        detail: { tipo, email: email||"", codigo: codigo||"", correoUsuario }
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
