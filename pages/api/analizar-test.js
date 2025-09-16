// ✅ pages/api/analizar-test.js
export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  // === Config (usa env vars si existen) ===
  const GAS_RESP_URL    = process.env.OBTENER_RESPUESTAS_TEST_URL
    || "https://script.google.com/macros/s/AKfycbwl84s-LVDjI__QT7V1NE4qX8a1Mew18yTQDe0M3EGnGpvGlckkrazUgZ1YYLS3xI_I9w/exec";
  const GAS_VERUSER_URL = process.env.VERIFICAR_CODIGO_Y_USUARIO_URL
    || "https://script.google.com/macros/s/AKfycbxfzxX_s97kIU4qv6M0dcaNrPIRxGDqECpd-uvoi5BDPVaIOY5ybWiVFiwqUss81Y-oNQ/exec";
  const API_ENVIAR_CORREO = process.env.API_ENVIAR_CORREO
    || "https://aurea-backend-two.vercel.app/api/enviar-correo";
  const LICENCIAS_URL = process.env.LICENCIAS_URL
    || "https://script.google.com/macros/s/AKfycbzvlZIbTZEBR03VwnDyYdoX3WXFe8cd0zKsR4W-SxxJqozo4ek9wYyIbtEJKNznV10VJg/exec";

  const ATTEMPT_TIMEOUT_MS = 12000;

  // === Utils ===
  const normTipo = (t) => String(t || "").trim().toLowerCase();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const inval = (v) => {
    const s = (v == null ? "" : String(v)).trim().toLowerCase();
    return s === "" || s === "none" || s === "null" || s === "undefined" || s === "n/a";
  };

  async function postJSON(url, data, timeoutMs = ATTEMPT_TIMEOUT_MS, label = "postJSON") {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data || {}),
        signal: ctrl.signal
      });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch (_) {}
      return { ok: r.ok, j, text, status: r.status, label };
    } finally {
      clearTimeout(id);
    }
  }

  try {
    const { tipoInstitucion, email, correoSOS, codigo } = req.body || {};
    if (!tipoInstitucion) return res.status(400).json({ ok: false, error: "tipoInstitucion requerido" });

    const tipo = normTipo(tipoInstitucion);

    // 1) GAS: obtener fila (por email si viene; si no, primer pendiente)
    async function obtenerFila() {
      const payload = { tipoInstitucion: tipo };
      if (email) payload.email = String(email).toLowerCase();
      return await postJSON(GAS_RESP_URL, payload, ATTEMPT_TIMEOUT_MS, "GAS_RESP_URL");
    }

    let g = await obtenerFila();
    if (!g.j?.ok) {
      // Reintento por posible latencia (5s)
      await sleep(5000);
      g = await obtenerFila();
      if (!g.j?.ok) {
        return res.status(200).json({
          ok: false,
          stage: "GAS",
          error: g.j?.error || g.text || "GAS sin pendiente",
          detail: { tipo, email: email || "", codigo: codigo || "" }
        });
      }
    }

    // Datos de la fila obtenida
    const correoUsuario = String(g.j.usuario || "").toLowerCase();
    let nombre = g.j.nombre || "";
    const sexo = g.j.sexo || "";
    const fechaNacimiento = g.j.fechaNacimiento || "";
    const respuestas = g.j.respuestas || {};
    const comentarioLibre = inval(g.j.info) ? "" : String(g.j.info).trim();

    // 2) Intentar enriquecer nombre desde Usuarios (si no vino)
    if (!nombre && correoUsuario) {
      try {
        const r = await postJSON(GAS_VERUSER_URL, { correo: correoUsuario, codigo: codigo || "" }, ATTEMPT_TIMEOUT_MS, "GAS_VERUSER_URL");
        const usr = r?.j?.usuario;
        if (usr && (usr.nombre || usr.apellido)) {
          nombre = [usr.nombre || "", usr.apellido || ""].join(" ").trim();
        }
      } catch (_) { /* noop */ }
      if (!nombre) nombre = correoUsuario.split("@")[0];
    }

    // 2.1) 🔐 Consumir licencia SOLO si el usuario NO estaba registrado (evita sumar por teclear código sin terminar)
    try {
      if (correoUsuario && codigo) {
        const verResp = await postJSON(
          GAS_VERUSER_URL,
          { correo: correoUsuario, codigo: codigo || "" },
          ATTEMPT_TIMEOUT_MS,
          "GAS_VERUSER_URL(check)"
        );
        const esNuevo = verResp?.j?.yaRegistrado === false;
        if (esNuevo) {
          const lic = await postJSON(
            LICENCIAS_URL,
            { codigo: String(codigo).toUpperCase(), yaRegistrado: false, intencionRegistro: true },
            ATTEMPT_TIMEOUT_MS,
            "LICENCIAS_URL(consumir)"
          );
          // Si Licencias dice "no acceso" (sin cupo), preferimos no bloquear el análisis por ahora:
          // registramos y seguimos para no romper la UX. Si quieres BLOQUEAR, cambia a "return res.status(200).json({ ok:false, stage:'LICENCIAS', ... })"
          if (!lic?.ok || lic?.j?.acceso !== true) {
            console.warn("⚠️ No se pudo consumir licencia:", lic?.j || lic?.text || lic?.status);
          }
        }
      }
    } catch (e) {
      console.warn("⚠️ Error al consumir licencia:", e?.message || e);
    }

    // 3) PROMPT — INTACTO (no modificar)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "Falta OPENAI_API_KEY" });

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
        detail: { tipo, email: email || "", codigo: codigo || "", correoUsuario }
      });
    }

    // 5) Enviar correo (Usuario + correoSOS + Alfredo SIEMPRE)
    const destinatarios = [
      correoUsuario,
      (correoSOS || "").trim(),
      "alfredo@positronconsulting.com"
    ].filter(Boolean);

    const enviar = await fetch(API_ENVIAR_CORREO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Compatibilidad con tu API actual:
        usuario: { nombre, correo: correoUsuario },
        tipoInstitucion: tipo,
        perfil: resultado.perfil,
        alertaSOS: !!resultado.sos,
        temaDetectado: resultado.tema,
        correoSOS: correoSOS || "",

        // ✅ Garantía explícita de destinatarios:
        to: [correoUsuario],                                   // usuario
        cc: destinatarios.filter(d => d !== correoUsuario),    // cc correoSOS + Alfredo
        bcc: [],                                               // opcional
        extraDestinatarios: destinatarios                      // por si tu API usa este campo
      })
    });

    const envJson = await enviar.json().catch(() => ({}));
    if (!enviar.ok || !envJson?.ok) {
      return res.status(200).json({
        ok: false,
        stage: "SENDMAIL",
        error: envJson?.error || "Fallo al enviar correo",
        detail: { tipo, email: email || "", codigo: codigo || "", correoUsuario }
      });
    }

    // OK
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
