// pages/api/orquestador.js
// ======================= AUREA ORQUESTADOR — FINAL =======================
// CORS fijo, GAS con 'correo', Hedge de OpenAI (dos llamadas en paralelo con timeout),
// JSON estricto, 11 temas, EMA 60/40 con umbral 60, backups y telemetría.

// ------------------ CORS ------------------
export default async function handler(req, res) {
  const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug, X-Debug-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const t0 = Date.now();
  const action = String((req.query || {}).action || '').trim().toLowerCase();
  const body = req.body || {};
  const routeLabel = `orq/${action || 'none'}`;

  // ------------------ Helpers base ------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchTimeout(url, options = {}, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(id);
      return r;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  }
  async function fetchRetry(url, options, timeoutMs, retries = 1, backoffMs = 500) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetchTimeout(url, options, timeoutMs);
        if (!r.ok && (r.status >= 500 || r.status === 429)) throw new Error(`HTTP ${r.status}`);
        return r;
      } catch (e) {
        lastErr = e;
        if (i < retries) await sleep(backoffMs * Math.pow(2, i));
      }
    }
    throw lastErr;
  }

  // ------------------ Redis (Upstash) ------------------
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const TTL_MAIN = 60 * 60;         // 60 min
  const TTL_BACKUP = 24 * 60 * 60;  // 24h
  async function rGet(key) {
    if (!REDIS_URL || !REDIS_TOKEN) return null;
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const j = await r.json().catch(() => ({}));
    if (j?.result == null) return null;
    try { return JSON.parse(j.result); } catch { return j.result; }
  }
  async function rSet(key, value, ttlSec = TTL_MAIN) {
    if (!REDIS_URL || !REDIS_TOKEN) return false;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (ttlSec) await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSec}`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    return true;
  }

  // ------------------ GAS & Email ------------------
  const GAS = {
    VERIFY: process.env.GAS_VERIFY_URL,             // verificarCodigoYUsuario.gs (usa 'correo')
    PERFIL: process.env.GAS_PERFIL_URL,             // perfilUsuario.gs (temas E–O + perfil base)
    UPDATE: process.env.GAS_UPDATE_PROFILE_URL,     // actualizarCalificacion / guardar perfil final
    LOGS: process.env.GAS_LOGS_URL,                 // registrarTokens.gs
    TEMAS: process.env.GAS_TEMAS_URL,               // temasInstitucion (métricas)
    HIST: process.env.GAS_HISTORIAL_URL,            // guardarHistorial (SOS)
    TEL: process.env.GAS_TELEMETRIA_URL             // Telemetria.gs
  };

  async function telemetry({ usuario, ms, status, detalle }) {
    if (!GAS.TEL) return;
    const payload = { fecha: new Date().toISOString(), usuario: usuario || 'anon', ruta: routeLabel, ms, status, detalle: String(detalle || '') };
    try { await fetchRetry(GAS.TEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 8000, 0); } catch {}
  }

  async function logTokens({ usuario, institucion, usage, costoUSD }) {
    if (!GAS.LOGS || !usage) return;
    const payload = {
      fecha: new Date().toISOString(),
      usuario: usuario || 'anon',
      institucion: institucion || '',
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costoUSD: Number(costoUSD || 0)
    };
    try { await fetchRetry(GAS.LOGS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 8000, 0); } catch {}
  }

  async function sendEmail({ to, subject, text }) {
    const key = process.env.SENDGRID_API_KEY;
    if (!key || !to) return false;
    try {
      const r = await fetchRetry('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: 'no-reply@positronconsulting.com', name: 'AUREA' },
          reply_to: { email: 'alfredo@positronconsulting.com', name: 'Alfredo' },
          subject,
          content: [{ type: 'text/plain', value: text }]
        })
      }, 8000, 0);
      return r.ok;
    } catch { return false; }
  }

  // ------------------ Keys de cache ------------------
  const K_LIC = (codigo) => `lic:${String(codigo || '').toUpperCase()}`;
  const K_USR = (email) => `usr:${String(email || '').toLowerCase()}`;
  const K_TEM = (tipo) => `temas:${String(tipo || '').toLowerCase()}`; // social|empresa|educacion
  const K_BKP = (email) => `bkpperfil:${String(email || '').toLowerCase()}`;

  // ------------------ OpenAI (hedge + JSON estricto) ------------------
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_COST = Number(process.env.OPENAI_COST_PER_TOKEN_USD || '0.000005'); // opcional
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const OPENAI_MODEL = 'gpt-4o-mini';

  function buildPrompt({ nombre, mensaje, temas }) {
    const lista = (Array.isArray(temas) && temas.length) ? temas.join(', ') : 'Ansiedad, Depresión, Burnout, Estrés, Comunicación, Trabajo en equipo, Productividad, Conflictos, Cambio, Motivación, Toma de decisiones';
    return `
Eres AUREA, psicoterapeuta especializado en Terapia Cognitivo Conductual y Neurociencia.
Debes RESPONDER EXCLUSIVAMENTE en JSON válido con EXACTAMENTE estas claves:
{
  "mensajeUsuario": "string",                // máx 100 palabras, profesional, empático PERO que rete (TCC)
  "temaDetectado": "string",                 // elegir 1 de la lista PERMITIDA o "Otro: <tema>"
  "porcentaje": 0-100,                       // entero (confianza sobre temaDetectado)
  "calificacionesPorTema": {                 // mapa con los 11 temas de la institución
    "<Tema1>": 0-100,
    "<Tema2>": 0-100
  },
  "SOS": "OK" | "ALERTA"                     // "ALERTA" si hay riesgo agudo (ideación/plan/intento suicida, daño a terceros, psicosis activa, violencia severa, consumo con riesgo inmediato)
}

Contexto del usuario:
- Nombre: ${nombre || 'Usuario'}
- Mensaje: "${String(mensaje || '').replace(/"/g, '\\"')}"

Temas PERMITIDOS (elige exactamente 1 para "temaDetectado"):
${lista}

Instrucciones clínicas y de estilo (OBLIGATORIAS):
- Responde SOLO el JSON sin texto adicional, sin comentarios ni explicaciones fuera del JSON.
- "mensajeUsuario": tono profesional TCC+Neuro, cálido pero NO complaciente; invita a insight y a un siguiente paso realista SOLO si es necesario.
- Forzar mapeo a UNO de los temas PERMITIDOS. Si no hay mapeo clínicamente defendible, usar "Otro: <tema>".
- "calificacionesPorTema": entero 0–100 para CADA uno de los 11 temas PERMITIDOS (0 si no presenta señales).
- "porcentaje": mejor estimación (entero) de certeza sobre "temaDetectado".
- "SOS": "ALERTA" ante riesgo agudo (criterios clínicos estándar). En tal caso, el "mensajeUsuario" debe ser más directivo pero con acompañamiento.
- Mantén precisión clínica; evita clichés, promesas vacías y frases de placebo. Sé claro, directo y respetuoso.
`.trim();
  }

  async function openAIOnce({ prompt, timeoutMs = 9000, temperature = 0.4 }) {
    const req = {
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    };
    const r = await fetchTimeout(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    }, timeoutMs);
    const data = await r.json().catch(() => ({}));
    if (!data?.choices?.[0]?.message?.content) throw new Error('Respuesta vacía de OpenAI');
    let json;
    try { json = JSON.parse(data.choices[0].message.content); }
    catch { throw new Error('Formato inválido (no JSON)'); }
    const usage = data.usage || {};
    const costo = usage.total_tokens ? Number((usage.total_tokens * OPENAI_COST).toFixed(6)) : 0;
    return { json, usage, costo };
  }

  // Hedge: dos llamadas en paralelo con timeouts distintos, devolvemos la PRIMERA válida.
  async function callOpenAI_Hedge({ prompt }) {
    // A: baja temperatura (más estable), timeout 9s
    const pA = openAIOnce({ prompt, timeoutMs: 9000, temperature: 0.3 });
    // B: temperatura 0.5 (por si A tropieza), timeout 12s
    const pB = openAIOnce({ prompt, timeoutMs: 12000, temperature: 0.5 });

    return await Promise.any([pA, pB]);
  }

  // ------------------ Utilidades de negocio ------------------
  function ema6040(actual, nuevo) {
    const a = Number(actual || 0), n = Math.max(0, Math.min(100, Number(nuevo || 0)));
    return Math.round(0.6 * a + 0.4 * n);
  }
  function normalizarCalifMap(temas, mapa) {
    const out = {};
    for (const t of temas) {
      const v = mapa && Object.prototype.hasOwnProperty.call(mapa, t) ? Number(mapa[t]) : 0;
      out[t] = Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }
    return out;
  }

  // ------------------ Temas/Perfil desde GAS_PERFIL_URL ------------------
  async function obtenerTemasYPerfil(tipoInstitucion, correo) {
    const cacheKey = K_TEM(tipoInstitucion);
    let temas = await rGet(cacheKey);
    let perfil = null;

    if (!Array.isArray(temas) || temas.length !== 11 || !perfil) {
      const r = await fetchRetry(GAS.PERFIL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, tipoInstitucion })
      }, 12000, 1);
      const data = await r.json().catch(() => ({}));
      if (!data?.ok || !Array.isArray(data.temas) || !data.temas.length) {
        return { temas: [], perfil: {} };
      }
      temas = data.temas;
      perfil = data.perfil || {};
      await rSet(cacheKey, temas, TTL_MAIN);
    }
    return { temas, perfil: perfil || {} };
  }

  // ------------------ GAS calls ------------------
  async function verificarCodigoUsuario({ email, codigo }) {
    const r = await fetchRetry(GAS.VERIFY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // El GAS espera 'correo'
      body: JSON.stringify({ correo: email, codigo })
    }, 12000, 1);
    return r.json();
  }

  async function actualizarGAS(payload) {
    const r = await fetchRetry(GAS.UPDATE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 12000, 1);
    return r.json();
  }

  // ------------------ Actions ------------------
  try {
    // version
    if (action === 'version') {
      const flags = {
        FRONTEND_ORIGIN: !!process.env.FRONTEND_ORIGIN,
        OPENAI_API_KEY: !!OPENAI_API_KEY,
        UPSTASH_URL: !!REDIS_URL,
        UPSTASH_TOKEN: !!REDIS_TOKEN,
        SENDGRID: !!process.env.SENDGRID_API_KEY,
        GAS_VERIFY: !!GAS.VERIFY,
        GAS_PERFIL: !!GAS.PERFIL,
        GAS_UPDATE: !!GAS.UPDATE,
        GAS_LOGS: !!GAS.LOGS,
        GAS_TEMAS: !!GAS.TEMAS,
        GAS_HIST: !!GAS.HIST,
        GAS_TEL: !!GAS.TEL
      };
      return res.status(200).json({ ok: true, flags, now: new Date().toISOString() });
    }

    // temas (diagnóstico)
    if (action === 'temas') {
      const { tipoInstitucion } = body || {};
      if (!tipoInstitucion) return res.status(400).json({ ok: false, error: 'tipoInstitucion requerido' });
      const { temas } = await obtenerTemasYPerfil(String(tipoInstitucion).toLowerCase(), 'diagnostic@aurea');
      return res.status(200).json({ ok: true, temas });
    }

    // registro (ligero; valida código y precalienta temas)
    if (action === 'registro') {
      const { codigo } = body || {};
      if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });

      let lic = await rGet(K_LIC(codigo));
      if (!lic) {
        const ver = await verificarCodigoUsuario({ email: null, codigo });
        if (!ver?.ok) return res.status(400).json({ ok: false, error: ver?.motivo || 'Código inválido' });
        lic = {
          codigo: String(codigo).toUpperCase(),
          activo: ver?.codigoActivo ?? true,
          disponibles: ver?.licenciasDisponibles ?? null,
          tipoInstitucion: ver?.tipoInstitucion || null,
          correoSOS: ver?.correoSOS || null,
          institucion: ver?.institucion || null
        };
        await rSet(K_LIC(codigo), lic, TTL_MAIN);
      }
      if (lic?.tipoInstitucion) { try { await obtenerTemasYPerfil(lic.tipoInstitucion, 'preload@aurea'); } catch {} }
      return res.status(200).json({ ok: true, licencia: lic });
    }

    // login
    if (action === 'login') {
      const { email, codigo } = body || {};
      if (!email || !codigo) return res.status(400).json({ ok: false, error: 'email y codigo requeridos' });

      const ver = await verificarCodigoUsuario({ email, codigo });
      if (!ver?.ok || !ver?.acceso) return res.status(403).json({ ok: false, error: ver?.motivo || 'Acceso denegado' });

      const usuario = ver?.usuario || {};
      const lic = {
        codigo: String(codigo).toUpperCase(),
        activo: ver?.codigoActivo ?? true,
        disponibles: ver?.licenciasDisponibles ?? null,
        tipoInstitucion: ver?.tipoInstitucion || null,
        correoSOS: ver?.correoSOS || null,
        institucion: ver?.institucion || null
      };
      await rSet(K_LIC(codigo), lic, TTL_MAIN);
      await rSet(K_USR(email), {
        nombre: usuario?.nombre || '',
        edad: usuario?.edad || usuario?.fechaNacimiento || '',
        institucion: lic.institucion,
        tipoInstitucion: lic.tipoInstitucion,
        correoSOS: lic.correoSOS,
        correoEmergencia: usuario?.correoEmergencia || null
      }, TTL_MAIN);

      // Temas + perfil base
      const { temas, perfil } = await obtenerTemasYPerfil(String(lic.tipoInstitucion || '').toLowerCase(), email);

      // BG si test inicial no se ha enviado (AW)
      const awMarcado = !!usuario?.testYaEnviado;
      (async () => {
        try {
          if (!awMarcado) {
            await actualizarGAS({ modo: 'ANALISIS_INICIAL', email, codigo: lic.codigo, tipoInstitucion: lic.tipoInstitucion });
            const asunto = 'Bienvenido/a a AUREA. Este es el resultado de tu test.';
            await sendEmail({ to: email, subject: asunto, text: 'Gracias por registrarte en AUREA. Procesamos tu test inicial.' });
            if (lic.correoSOS) await sendEmail({ to: lic.correoSOS, subject: asunto, text: `Se procesó el test de ${email}` });
            await sendEmail({ to: 'alfredo@positronconsulting.com', subject: asunto, text: `Se procesó el test de ${email}` });
          }
        } catch {}
      })();

      return res.status(200).json({
        ok: true,
        acceso: true,
        usuario: {
          email,
          nombre: usuario?.nombre || '',
          edad: usuario?.edad || usuario?.fechaNacimiento || '',
          institucion: lic.institucion,
          tipoInstitucion: lic.tipoInstitucion,
          correoSOS: lic.correoSOS,
          correoEmergencia: usuario?.correoEmergencia || null,
          perfilEmocional: null
        },
        temas,
        perfilBase: perfil
      });
    }

    // chat (OpenAI hedge; siempre respuesta de OpenAI)
    if (action === 'chat') {
      const email = String(body.email || body.correo || '').toLowerCase();
      const nombre = body.nombre || '';
      const codigo = body.codigo || '';
      const tipoInstitucion = String(body.tipoInstitucion || '').toLowerCase();
      const mensaje = body.mensaje || '';
      const perfilActual = body.perfilActual || {};

      if (!mensaje || !tipoInstitucion) return res.status(400).json({ ok: false, error: 'mensaje y tipoInstitucion requeridos' });

      // Lista de 11 temas (desde GAS_PERFIL)
      const { temas } = await obtenerTemasYPerfil(tipoInstitucion, email || 'chat@aurea');
      if (!Array.isArray(temas) || temas.length !== 11) return res.status(500).json({ ok: false, error: 'Temas inválidos' });

      const prompt = buildPrompt({ nombre, mensaje, temas });

      // Hedge: dos intentos paralelos, devolvemos el primero válido
      const { json, usage, costo } = await callOpenAI_Hedge({ prompt }).catch(e => { throw e; });
      await logTokens({ usuario: email || 'anon', institucion: '', usage, costoUSD: costo });

      // Normalización estricta
      const temaDetectado = String(json?.temaDetectado || '').trim();
      const porcentaje = Math.max(0, Math.min(100, Number(json?.porcentaje || 0)));
      const califMap = normalizarCalifMap(temas, json?.calificacionesPorTema || {});
      const SOS = String(json?.SOS || 'OK').toUpperCase() === 'ALERTA' ? 'ALERTA' : 'OK';
      const mensajeUsuario = String(json?.mensajeUsuario || '').trim();

      // Perfil sugerido con EMA 60/40 si el tema es válido y %≥60
      const perfilNuevo = { ...(perfilActual || {}) };
      let notas = '';

      const temaValido = temaDetectado && temas.includes(temaDetectado);
      if (!temaValido) {
        if (temaDetectado && /^Otro:/i.test(temaDetectado)) notas = temaDetectado;
        else if (temaDetectado) notas = `Otro: ${temaDetectado}`;
      } else if (porcentaje >= 60) {
        const actual = Number(perfilNuevo[temaDetectado] || 0);
        const sugerida = Number(califMap[temaDetectado] || 0);
        perfilNuevo[temaDetectado] = ema6040(actual, sugerida);
      }

      // SOS → historial (no bloquea)
      if (SOS === 'ALERTA' && GAS.HIST) {
        try {
          await fetchRetry(GAS.HIST, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fecha: new Date().toISOString(),
              usuario: email || 'anon',
              mensaje,
              tema: temaValido ? temaDetectado : 'N/A',
              porcentaje,
              nota: notas || ''
            })
          }, 8000, 0);
        } catch {}
      }

      await telemetry({ usuario: email || 'anon', ms: Date.now() - t0, status: 'OK', detalle: 'chat' });

      return res.status(200).json({
        ok: true,
        mensajeUsuario: mensajeUsuario || 'Gracias por compartir.',
        temaDetectado: temaValido ? temaDetectado : '',
        porcentaje,
        calificacionesPorTema: califMap,
        SOS,
        notas,
        perfilSugerido: perfilNuevo
      });
    }

    // finalizar (acepta email o correo)
    if (action === 'finalizar') {
      const correo = String(body.correo || body.email || '').toLowerCase();
      const codigo = String(body.codigo || '').toUpperCase();
      const perfilCompleto = body.perfilCompleto;
      const notas = body.notas || '';

      if (!correo || !codigo || !perfilCompleto) {
        return res.status(400).json({ ok: false, error: 'correo, codigo y perfilCompleto requeridos' });
      }

      try {
        const r = await actualizarGAS({
          modo: 'GUARDAR_PERFIL_FINAL',
          email: correo,
          codigo,
          perfil: perfilCompleto,
          notas
        });
        if (!r?.ok) throw new Error('GAS no confirmó guardado');
        await telemetry({ usuario: correo, ms: Date.now() - t0, status: 'OK', detalle: 'finalizar' });
        return res.status(200).json({ ok: true, guardado: true });
      } catch (err) {
        await rSet(K_BKP(correo), { email: correo, codigo, perfilCompleto, notas, fecha: new Date().toISOString() }, TTL_BACKUP);
        await telemetry({ usuario: correo, ms: Date.now() - t0, status: 'BKP', detalle: 'finalizar->backup' });
        return res.status(200).json({ ok: true, guardado: false, backup: true });
      }
    }

    // action desconocida
    return res.status(400).json({ ok: false, error: 'action inválida' });

  } catch (err) {
    await telemetry({ usuario: body?.email || body?.correo || 'anon', ms: Date.now() - t0, status: 'ERR', detalle: String(err?.message || err) });
    const friendly = 'A veces la tecnología y yo no hablamos exactamente el mismo idioma y ocurren pequeñas fallas de comunicación. Reintentemos: si vuelve a pasar, cuéntame de nuevo en tus palabras qué te preocupa. Estoy contigo.';
    return res.status(500).json({ ok: false, error: 'Error interno', friendly });
  }
}
// ======================= FIN ORQUESTADOR =======================

