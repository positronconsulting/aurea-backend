// ✅ pages/api/analizar-test.js
export default async function handler(req, res) {
  // ── CORS ────────────────────────────────────────────────────────────────────
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

  // Logs de depuración (INTENCIONALMENTE sin máscara para ver claramente)
  console.log("🔐 [TEST] Token esperado (expected):", expected);
  console.log("🔐 [TEST] Token recibido (got):", got);

  if (!expected || got !== expected) {
    return res.status(401).json({ ok:false, error:"Unauthorized", expected, got });
  }

  // ── TEST BÁSICO: si llegamos aquí, la conexión worker → analizar-test funciona
  return res.status(200).json({ ok:true, msg:"Token válido, conexión establecida" });

  /* ===========================================================================
   *  ⬇️⬇️⬇️  LÓGICA ORIGINAL COMPLETA (INTACTA, COMENTADA)  ⬇️⬇️⬇️
   *  Para reactivar: quita el `return` del test de arriba y descomenta este bloque
   * ===========================================================================

  // 🔗 ENDPOINTS
  const GAS_RESP_URL     = "https://script.google.com/macros/s/AKfycbwOlx381TjxulLqMS0sSfgmqoQjWf_XopINzbuxy3zNw5EMXkKaO9CYGrYdyrh5iOi1ig/exec";
  const GAS_VERUSER_URL  = "https://script.google.com/macros/s/AKfycbxfzxX_s97kIU4qv6M0dcaNrPIRxGDqECpd-uvoi5BDPVaIOY5ybWiVFiwqUss81Y-oNQ/exec";
  const API_ENVIAR_CORREO = "https://aurea-backend-two.vercel.app/api/enviar-correo";

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const inval = (v) => {
    const s = (v==null ? "" : String(v)).trim().toLowerCase();
    return s === "" || s === "none" || s === "null" || s === "undefined" || s === "n/a";
  };

  // POST JSON con timeout
  async function postJSON(url, data, ms = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
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
      clearTimeout(timer);
    }
  }

  try {
    const { tipoInstitucion, email, correoSOS, codigo } = req.body || {};
    if (!tipoInstitucion) return res.status(400).json({ ok:false, error: "tipoInstitucion requerido" });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ ok:false, error:"Falta OPENAI_API_KEY" });

    const normTipo = (t) => String(t||"").trim().toLowerCase();
    const tipo = normTipo(tipoInstitucion);

    // 1) GAS: obtener fila (por email si viene; si no, primer pendiente) — con reintentos
    async function obtenerFila() {
      const payload = { tipoInstitucion: tipo };
      if (email) payload.email = String(email).toLowerCase();
      const backoffs = [0, 1500, 3000]; // 3 intentos
      let last = null;
      for (let i=0;i<backoffs.length;i++){
        if (backoffs[i]) await sleep(backoffs[i]);
        last = await postJSON(GAS_RESP_URL, payload, 12000);
        if (last?.j?.ok) return last;
      }
      return last; // devuelve el último para diagnóstico
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

    // 2) Intentar enriquecer nombre desde Usuarios (si no vino)
    if (!nombre && correoUsuario) {
      try {
        const r = await postJSON(GAS_VERUSER_URL, { correo: correoUsuario, codigo: codigo || "" }, 10000);
        const usr = r?.j?.usuario;
        if (usr && (usr.nombre || usr.apellido)) {
          nombre = [usr.nombre||"", usr.apellido||""].join(" ").trim();
        }
      } catch(_) { /* noop */ }
      if (!nombre) nombre = correoUsuario.split("@")[0];
    }

    // 3) PROMPT — INTACTO (no modificar)
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
          model: "gpt-4",
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

    const validoPerfil = (s) => !inval(s) && String(s).trim().length >= 50;

    // 4) OpenAI con validación fuerte y reintento
    let intento = 0, maxIntentos = 2, resultado;
    while (intento < maxIntentos) {
      const { out } = await pedirOpenAI();
      const perfil = out?.perfil || "";
      if (validoPerfil(perfil)) {
        resultado = { perfil, sos: !!out?.alertaSOS, tema: out?.temaDetectado || "" };
        break;
      }
      intento++;
    }

    if (!resultado) {
      return res.status(200).json({
        ok: false,
        stage: "OPENAI",
        error: "Perfil vacío/None/corto tras reintento",
        detail: { tipo, email: email||"", codigo: codigo||"", correoUsuario }
      });
    }

    // 5) Enviar correo (Usuario + correoSOS + Alfredo SIEMPRE) con reintento corto
    const destinatarios = [
      correoUsuario,
      (correoSOS || "").trim(),
      "alfredo@positronconsulting.com"
    ].filter(Boolean);

    async function enviarCorreo(payload) {
      // 2 intentos: 8s y 8s
      for (let i=0;i<2;i++){
        const r = await postJSON(API_ENVIAR_CORREO, payload, 8000);
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

  // ========================================================================== */
}
