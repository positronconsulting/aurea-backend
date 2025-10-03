// pages/api/orquestador.js
// AUREA — Orquestador Único (registro/login, temas, chat, finalizar)
// ───────────────────────────────────────────────────────────────────
// ENV requeridas (Vercel):
// FRONTEND_ORIGIN=https://www.positronconsulting.com
// OPENAI_API_KEY=sk-...
// OPENAI_TIMEOUT_MS=35000
// UPSTASH_REDIS_REST_URL=...
// UPSTASH_REDIS_REST_TOKEN=...
// SENDGRID_API_KEY=...
// GAS_VERIFY_URL=...           // verificarCodigoYUsuario.gs (devuelve usuario, temas, perfilBase)
// GAS_UPDATE_PROFILE_URL=...   // GuardaPerfilFinal.gs (GUARDAR_PERFIL_FINAL)
// GAS_LOGS_URL=...             // registrarTokens.gs
// GAS_HIST_URL=...             // guardarHistorial.gs (opcional para SOS)
// GAS_TEL_URL=...              // Telemetria.gs (opcional)
// OPENAI_COST_PER_TOKEN_USD=0.000005 (opcional)

export default async function handler(req, res) {
  // ── CORS ─────────────────────────────────────────────────────────
  const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug, X-Debug-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const t0 = Date.now();
  const { action } = (req.query || {});
  const body = (req.body || {});
  const routeLabel = `orq/${action || 'none'}`;

  // ── Helpers base ────────────────────────────────────────────────
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchTimeout(url, options = {}, timeoutMs = 12000, retries = 0, backoff = 500) {
    for (let i = 0; i <= retries; i++) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(id);
        if (!r.ok && (r.status >= 500 || r.status === 429)) throw new Error(`HTTP ${r.status}`);
        return r;
      } catch (e) {
        clearTimeout(id);
        if (i === retries) throw e;
        await wait(backoff * Math.pow(2, i));
      }
    }
  }

  // ── Redis (Upstash) ─────────────────────────────────────────────
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const TTL_1H = 60 * 60;
  const TTL_24H = 24 * 60 * 60;

  async function rGet(key) {
    if (!REDIS_URL || !REDIS_TOKEN) return null;
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const j = await r.json();
    if (j?.result == null) return null;
    try { return JSON.parse(j.result); } catch { return j.result; }
  }
  async function rSet(key, value, ttlSec = TTL_1H) {
    if (!REDIS_URL || !REDIS_TOKEN) return false;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSec}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    return true;
  }

  // ── Keys de caché ───────────────────────────────────────────────
  const K_LIC = (codigo) => `lic:${String(codigo || '').toUpperCase()}`;
  const K_USR = (email) => `usr:${String(email || '').toLowerCase()}`;
  const K_TEM = (tipo) => `temas:${String(tipo || '').toLowerCase()}`;       // social|empresa|educacion
  const K_BKP = (email) => `bkpperfil:${String(email || '').toLowerCase()}`;

  // ── GAS & Email ─────────────────────────────────────────────────
  const GAS = {
    VERIFY: process.env.GAS_VERIFY_URL,            // verificarCodigoYUsuario.gs
    UPDATE: process.env.GAS_UPDATE_PROFILE_URL,    // GuardaPerfilFinal.gs
    LOGS: process.env.GAS_LOGS_URL,                // registrarTokens.gs
    HIST: process.env.GAS_HIST_URL,                // guardarHistorial.gs (opcional)
    TEL: process.env.GAS_TEL_URL                   // Telemetria.gs (opcional)
  };

  async function telemetry({ usuario, ms, status, detalle }) {
    if (!GAS.TEL) return;
    const payload = {
      fecha: new Date().toISOString(),
      usuario: usuario || 'anon',
      ruta: routeLabel,
      ms,
      status,
      detalle: String(detalle || '')
    };
    try {
      await fetchTimeout(GAS.TEL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 12000, 0);
    } catch { /* silent */ }
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
    try {
      await fetchTimeout(GAS.LOGS, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 12000, 0);
    } catch { /* silent */ }
  }

  async function sendEmail({ to, subject, text }) {
    const key = process.env.SENDGRID_API_KEY;
    if (!key || !to) return false;
    const r = await fetchTimeout('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: 'no-reply@positronconsulting.com', name: 'AUREA' },
        reply_to: { email: 'alfredo@positronconsulting.com', name: 'Alfredo' },
        subject,
        content: [{ type: 'text/plain', value: text }]
      })
    }, 12000, 0);
    return r.ok;
  }

  // ── OpenAI ──────────────────────────────────────────────────────
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_COST = Number(process.env.OPENAI_COST_PER_TOKEN_USD || '0.000005');
  const OPENAI_TMO = Number(process.env.OPENAI_TIMEOUT_MS || '35000');

  function buildPrompt({ nombre, mensaje, temas }) {
    const lista = (Array.isArray(temas) && temas.length) ? temas.join(', ') : 'Ansiedad, Depresión, Burnout';
    return `
Eres AUREA, psicoterapeuta especializado en Terapia Cognitivo Conductual y Neurociencia.
Debes RESPONDER EXCLUSIVAMENTE en JSON válido con EXACTAMENTE estas claves:
{
  "mensajeUsuario": "string",
  "temaDetectado": "string",
  "porcentaje": 0-100,
  "calificacionesPorTema": {
    "<Tema1>": 0-100,
    "<Tema2>": 0-100
  },
  "SOS": "OK" | "ALERTA"
}

Contexto del usuario:
- Nombre: ${nombre || 'Usuario'}
- Mensaje: "${String(mensaje || '').replace(/"/g, '\\"')}"

Temas PERMITIDOS (elige exactamente 1 para "temaDetectado"):
${lista}

Instrucciones clínicas y de estilo (OBLIGATORIAS):
- Responde SOLO el JSON sin texto adicional ni comentarios fuera del JSON.
- "mensajeUsuario": máx 100 palabras, profesional TCC + Neuro; empático pero NO complaciente; invita a insight y a un siguiente paso realista SOLO si es necesario.
- Forzar mapeo a UNO de los temas PERMITIDOS. Si no es clínicamente defendible, usar "Otro: <tema>".
- "calificacionesPorTema": entero 0–100 para CADA uno de los 11 temas PERMITIDOS (0 si no presenta señales).
- "porcentaje": entero 0–100 de certeza sobre "temaDetectado".
- "SOS": "ALERTA" ante riesgo agudo (ideación/plan/intento suicida, daño a terceros, psicosis activa, violencia severa, consumo con riesgo inmediato). En tal caso, el "mensajeUsuario" será más directivo con acompañamiento.
- Evita clichés y frases de placebo. Sé claro, directo y respetuoso.
`.trim();
  }

  async function callOpenAI({ prompt }) {
    const req = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    };

    const r = await fetchTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    }, OPENAI_TMO, 0); // ← un solo intento, timeout controlado

    const data = await r.json().catch(() => ({}));
    if (!data?.choices?.[0]?.message?.content) throw new Error('Respuesta vacía de OpenAI');

    let json;
    try { json = JSON.parse(data.choices[0].message.content); }
    catch { throw new Error('Formato inválido (no JSON)'); }

    const usage = data.usage || {};
    const costo = usage.total_tokens ? Number((usage.total_tokens * OPENAI_COST).toFixed(6)) : 0;
    return { json, usage, costo };
  }

  // ── Utilidades de negocio ───────────────────────────────────────
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

  // ── Obtener Temas (uso interno) ─────────────────────────────────
  // Primero intenta Redis; si no hay, opcionalmente podría llamar a GAS TEMAS (no requerido).
  async function obtenerTemas(tipoInstitucion) {
    const key = K_TEM(tipoInstitucion);
    const cached = await rGet(key);
    if (Array.isArray(cached) && cached.length) return cached;
    // Si no hay cache, devolvemos [] para no depender de GAS en runtime.
    return [];
  }

  try {
    // ── version ───────────────────────────────────────────────────
    if (action === 'version') {
      const flags = {
        FRONTEND_ORIGIN: !!process.env.FRONTEND_ORIGIN,
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        UPSTASH_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
        SENDGRID: !!process.env.SENDGRID_API_KEY,
        GAS_VERIFY: !!process.env.GAS_VERIFY_URL,
        GAS_PERFIL: !!process.env.GAS_PERFIL_URL, // por compatibilidad si existiera
        GAS_UPDATE: !!process.env.GAS_UPDATE_PROFILE_URL,
        GAS_LOGS: !!process.env.GAS_LOGS_URL,
        GAS_TEMAS: !!process.env.GAS_TEMAS_URL,
        GAS_HIST: !!process.env.GAS_HIST_URL,
        GAS_TEL: !!process.env.GAS_TEL_URL
      };
      return res.status(200).json({ ok: true, flags, now: new Date().toISOString() });
    }

    // ── registro (opcional) ───────────────────────────────────────
    if (action === 'registro') {
      const { codigo } = body || {};
      if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });

      // Guardamos licencia básica en cache (opcional)
      await rSet(K_LIC(codigo), { codigo: String(codigo).toUpperCase() }, TTL_1H);
      return res.status(200).json({ ok: true, licencia: { codigo: String(codigo).toUpperCase() } });
    }

    // ── login ─────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, codigo } = body || {};
      if (!email || !codigo) return res.status(400).json({ ok: false, error: 'email y codigo requeridos' });

      // Verificar con GAS (estricto por correo+codigo) — este GAS devuelve usuario, temas, perfilBase
      const rVer = await fetchTimeout(process.env.GAS_VERIFY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: email, codigo })
      }, 12000, 0);
      const ver = await rVer.json();

      if (!ver?.ok || !ver?.acceso) {
        return res.status(403).json({ ok: false, error: ver?.motivo || 'Acceso denegado', debug: ver });
      }

      const usuario = ver?.usuario || {};
      const tipo = (ver?.tipoInstitucion || usuario?.tipoInstitucion || '').toLowerCase();
      const institucion = ver?.institucion || '';
      const correoSOS = ver?.correoSOS || null;

      // Cachear temas de este tipo — **Clave del fix de “temas vacíos”**
      const temasLogin = Array.isArray(ver?.temas) ? ver.temas.map(t => String(t)) : [];
      if (tipo && temasLogin.length) {
        try { await rSet(K_TEM(tipo), temasLogin, TTL_24H); } catch {}
      }

      // Cachear usuario básico 1h
      await rSet(K_USR(email), {
        nombre: usuario?.nombre || '',
        edad: usuario?.fechaNacimiento || usuario?.edad || '',
        institucion,
        tipoInstitucion: tipo,
        correoSOS: correoSOS,
        correoEmergencia: usuario?.correoEmergencia || null,
        perfilEmocional: ver?.perfilBase || null
      }, TTL_1H);

      // Warm licencia
      await rSet(K_LIC(codigo), { codigo: String(codigo).toUpperCase(), tipoInstitucion: tipo, institucion, correoSOS }, TTL_1H);

      // BG: si el test no está enviado (AW), iniciar análisis inicial y correo
      const testYaEnviado = !!usuario?.testYaEnviado;
      (async () => {
        try {
          if (!testYaEnviado) {
            // Aquí solo notificamos proceso; el perfil llegará cuando GAS termine.
            const asunto = 'Bienvenido/a a AUREA. Este es el resultado de tu test.';
            // Enriquecer contenido para que no llegue “vacío”
            const base = ver?.perfilBase || null;
            const temasTxt = (temasLogin.length ? `Temas detectados para tu institución: ${temasLogin.join(', ')}\n` : '');
            const baseTxt = base ? `Perfil base inicial:\n${JSON.stringify(base, null, 2)}\n` : 'Perfil base inicial aún no disponible.\n';
            const textoU = `Hola ${usuario?.nombre || ''},
Tu análisis inicial está en proceso. Recibirás tu perfil completo en breve.
${temasTxt}${baseTxt}
— AUREA`;

            await sendEmail({ to: email, subject: asunto, text: textoU });
            if (correoSOS) await sendEmail({ to: correoSOS, subject: asunto, text: `Se procesó el test de ${email}` });
            await sendEmail({ to: 'alfredo@positronconsulting.com', subject: asunto, text: `Se procesó el test de ${email}` });
          }
        } catch { /* no bloquear login */ }
      })();

      return res.status(200).json({
        ok: true,
        acceso: true,
        usuario: {
          email,
          nombre: usuario?.nombre || '',
          edad: usuario?.fechaNacimiento || usuario?.edad || '',
          institucion,
          tipoInstitucion: tipo,
          correoSOS,
          correoEmergencia: usuario?.correoEmergencia || null,
          perfilEmocional: ver?.perfilBase || null
        },
        temas: temasLogin,
        perfilBase: ver?.perfilBase || null
      });
    }

    // ── temas (solo caché) ────────────────────────────────────────
    if (action === 'temas') {
      const { tipoInstitucion } = body || {};
      if (!tipoInstitucion) return res.status(400).json({ ok: false, error: 'tipoInstitucion requerido' });
      const temas = await rGet(K_TEM(tipoInstitucion));
      return res.status(200).json({ ok: true, temas: Array.isArray(temas) ? temas : [] });
    }

    // ── chat ──────────────────────────────────────────────────────
    if (action === 'chat') {
      const { email, nombre, codigo, tipoInstitucion, mensaje, perfilActual } = body || {};
      if (!mensaje || !tipoInstitucion) return res.status(400).json({ ok: false, error: 'mensaje y tipoInstitucion requeridos' });

      const temas = await obtenerTemas(tipoInstitucion); // cache-first; si vacío, lista mínima en prompt
      const prompt = buildPrompt({ nombre, mensaje, temas: temas.length ? temas : undefined });

      const { json, usage, costo } = await callOpenAI({ prompt });
      await logTokens({ usuario: email || 'anon', institucion: '', usage, costoUSD: costo });

      // Normalización
      const tema = String(json?.temaDetectado || '').trim();
      const porcentaje = Math.max(0, Math.min(100, Number(json?.porcentaje || 0)));
      const temaValido = temas.includes(tema);
      const califMap = normalizarCalifMap(temas.length ? temas : Object.keys(json?.calificacionesPorTema || {}), json?.calificacionesPorTema);
      const SOS = String(json?.SOS || 'OK').toUpperCase() === 'ALERTA' ? 'ALERTA' : 'OK';
      const mensajeUsuario = String(json?.mensajeUsuario || '').trim();

      // Perfil sugerido (EMA 60/40 sólo si tema pertenece a la lista y porcentaje ≥ 60)
      const perfilNuevo = { ...(perfilActual || {}) };
      let notas = '';
      if (!temaValido) {
        if (tema && /^Otro:/i.test(tema)) notas = tema;
        else if (tema) notas = `Otro: ${tema}`;
      } else if (porcentaje >= 60) {
        const actual = Number(perfilNuevo[tema] || 0);
        const sugerida = Number(califMap[tema] || 0);
        perfilNuevo[tema] = ema6040(actual, sugerida);
      }

      // SOS → historial (opcional)
      if (SOS === 'ALERTA' && GAS.HIST) {
        try {
          await fetchTimeout(GAS.HIST, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fecha: new Date().toISOString(),
              usuario: email || 'anon',
              mensaje,
              tema: temaValido ? tema : 'N/A',
              porcentaje,
              nota: notas || ''
            })
          }, 12000, 0);
        } catch {}
      }

      await telemetry({ usuario: email || 'anon', ms: Date.now() - t0, status: 'OK', detalle: 'chat' });

      return res.status(200).json({
        ok: true,
        mensajeUsuario: mensajeUsuario || 'Gracias por compartir.',
        temaDetectado: temaValido ? tema : '',
        porcentaje,
        calificacionesPorTema: califMap,
        SOS,
        notas,
        perfilSugerido: perfilNuevo
      });
    }

    // ── finalizar ─────────────────────────────────────────────────
    if (action === 'finalizar') {
      const { email, codigo, tipoInstitucion, perfilCompleto, notas } = body || {};
      if (!email || !codigo || !tipoInstitucion || !perfilCompleto) {
        return res.status(400).json({ ok: false, error: 'correo, codigo, tipoInstitucion y perfilCompleto requeridos' });
      }

      // Llamar a GAS de guardado final (ya probado en ReqBin)
      try {
        const r = await fetchTimeout(process.env.GAS_UPDATE_PROFILE_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modo: 'GUARDAR_PERFIL_FINAL',
            email,
            codigo: String(codigo).toUpperCase(),
            tipoInstitucion: String(tipoInstitucion).toLowerCase(),
            perfil: perfilCompleto,
            notas: notas || ''
          })
        }, 12000, 0);

        const j = await r.json().catch(() => ({}));
        if (!j?.ok) throw new Error(j?.error || 'GAS no confirmó guardado');

        await telemetry({ usuario: email, ms: Date.now() - t0, status: 'OK', detalle: 'finalizar' });
        return res.status(200).json({ ok: true, guardado: true });

      } catch (err) {
        // Backup 24h en Redis para no perder datos
        await rSet(K_BKP(email), { email, codigo, perfilCompleto, notas: notas || '', fecha: new Date().toISOString() }, TTL_24H);
        await telemetry({ usuario: email, ms: Date.now() - t0, status: 'BKP', detalle: `finalizar->backup (${String(err?.message || err)})` });
        return res.status(200).json({ ok: true, guardado: false, backup: true });
      }
    }

    // ── fallback ──────────────────────────────────────────────────
    return res.status(400).json({ ok: false, error: 'action inválida' });

  } catch (err) {
    await telemetry({ usuario: body?.email || 'anon', ms: Date.now() - t0, status: 'ERR', detalle: String(err?.message || err) });
    const friendly = 'A veces la tecnología y yo no hablamos exactamente el mismo idioma y ocurren pequeñas fallas de comunicación. Reintentemos: si vuelve a pasar, cuéntame de nuevo en tus palabras qué te preocupa. Estoy contigo.';
    return res.status(500).json({ ok: false, error: 'Error interno', friendly });
  }
}
