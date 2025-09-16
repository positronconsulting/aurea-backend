// ✅ pages/api/analizar-test.js

// ---- Concurrency gate (suave) ----
let running = 0;
const queue = [];
const LIMIT = 2; // procesa 2 análisis simultáneos por instancia

function withGate(fn) {
  return new Promise((resolve, reject) => {
    const task = async () => {
      running++;
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      finally {
        running--;
        const next = queue.shift();
        if (next) next();
      }
    };
    (running < LIMIT) ? task() : queue.push(task);
  });
}

export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const { tipoInstitucion, email, correoSOS, codigo } = req.body || {};
    if (!tipoInstitucion) return res.status(400).json({ ok:false, error: "tipoInstitucion requerido" });

    const GAS_RESP_URL    = "https://script.google.com/macros/s/AKfycbwOlx381TjxulLqMS0sSfgmqoQjWf_XopINzbuxy3zNw5EMXkKaO9CYGrYdyrh5iOi1ig/exec".replace('v8a','v8a'); // (igual)
    const GAS_VERUSER_URL = "https://script.google.com/macros/s/AKfycbxfzxX_s97kIU4qv6M0dcaNrPIRxGDqECpd-uvoi5BDPVaIOY5ybWiVFiwqUss81Y-oNQ/exec";
    const API_ENVIAR_CORREO = "https://aurea-backend-two.vercel.app/api/enviar-correo";

    const normTipo = (t) => String(t||"").trim().toLowerCase();
    const tipo = normTipo(tipoInstitucion);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const inval = (v) => {
      const s = (v==null ? "" : String(v)).trim().toLowerCase();
      return s === "" || s === "none" || s === "null" || s === "undefined" || s === "n/a";
    };

    async function postJSON(url, data) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {})
      });
      const text = await r.text();
      let j=null; try{ j=JSON.parse(text); } catch(_){}
      return { ok: r.ok, j, text, status: r.status };
    }

    async function obtenerFila() {
      const payload = { tipoInstitucion: tipo };
      if (email) payload.email = String(email).toLowerCase();
      return await postJSON(GAS_RESP_URL, payload);
    }

    // ⬇️ TODO el bloque pesado corre dentro del gate
    return await withGate(async () => {
      let g = await obtenerFila();
      if (!g.j?.ok) {
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

      const correoUsuario = String(g.j.usuario || "").toLowerCase();
      let nombre = g.j.nombre || "";
      const sexo = g.j.sexo || "";
      const fechaNacimiento = g.j.fechaNacimiento || "";
      const respuestas = g.j.respuestas || {};
      const comentarioLibre = inval(g.j.info) ? "" : String(g.j.info).trim();

      // 2) Enriquecer nombre (si falta)
      if (!nombre && correoUsuario) {
        try {
          const r = await postJSON(GAS_VERUSER_URL, { correo: correoUsuario, codigo: codigo || "" });
          const usr = r?.j?.usuario;
          if (usr && (usr.nombre || usr.apellido)) {
            nombre = [usr.nombre||"", usr.apellido||""].join(" ").trim();
          }
        } catch(_) { /* noop */ }
        if (!nombre) nombre = correoUsuario.split("@")[0];
      }

      // 3) PROMPT — INTACTO (no modificar)
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ ok:false, error:"Falta OPENAI_API_KEY" });

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

      const validoPerfil = (s) => {
        if (!s) return false;
        const st = String(s).trim();
        return st.length >= 50 && !/^none|null|undefined$/i.test(st);
      };

      // 4) OpenAI con validación y reintento
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
        })
      });

      const envJson = await enviar.json().catch(() => ({}));
      if (!enviar.ok || !envJson?.ok) {
        return res.status(200).json({
          ok: false,
          stage: "SENDMAIL",
          error: envJson?.error || "Fallo al enviar correo",
          detail: { tipo, email: email||"", codigo: codigo||"", correoUsuario }
        });
      }

      return res.status(200).json({ ok: true });
    });

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
