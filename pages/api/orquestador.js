// pages/api/orquestador.js — FINAL con DEBUG integrado
// ENV requeridas (Vercel):
// FRONTEND_ORIGIN=https://www.positronconsulting.com
// OPENAI_API_KEY=...
// UPSTASH_REDIS_REST_URL=...
// UPSTASH_REDIS_REST_TOKEN=...
// SENDGRID_API_KEY=...
// GAS_VERIFY_URL=...
// GAS_UPDATE_PROFILE_URL=...
// GAS_LOGS_URL=...
// GAS_TEMAS_URL=...
// GAS_HISTORIAL_URL=...
// GAS_TELEMETRIA_URL=...
// OPENAI_COST_PER_TOKEN_USD=0.000005 (opcional)
// DEBUG_TOKEN=opcional (si lo pones, para usar debug debes mandar header X-Debug-Token igual)

export default async function handler(req, res) {
  // --- CORS robusto (prod + Wix preview) ---
  const ALLOWED_ORIGINS = [
    process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com',
    'https://editor.wix.com',
    'https://manage.wix.com'
    // agrega aquí tu dominio wixsite si usas preview público
  ];
  function setCors(res, req) {
    const reqOrigin = req.headers.origin || '';
    const allow = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug, X-Debug-Token');
  }
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const t0 = Date.now();
  // acepta action por query o body
  const action = (req.query && req.query.action) || (req.body && req.body.action) || null;
  const body = (req.body || {});
  const routeLabel = `orq/${action || 'none'}`;

  // --- DEBUG mode ---
  const debugQS = String(req.query?.debug || '').trim() === '1';
  const debugHdr = String(req.headers['x-debug'] || '').trim() === '1';
  const tokenOk = !process.env.DEBUG_TOKEN || (req.headers['x-debug-token'] === process.env.DEBUG_TOKEN);
  const DEBUG = (debugQS || debugHdr) && tokenOk;

  // --- Helpers base ---
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  function tagError(tag, e) {
    const err = new Error(`${tag}: ${e?.message || String(e)}`);
    err._tag = tag;
    err._raw = e;
    return err;
  }
  async function fetchTimeout(url, options = {}, timeoutMs = 12000, retries = 2, backoff = 500) {
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
        await wait(backoff * Math.pow(3, i));
      }
    }
  }

  // --- Redis (Upstash) ---
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const TTL_MAIN = 60 * 60;         // 60 min
  const TTL_BACKUP = 24 * 60 * 60;  // 24h

  async function rGet(key) {
    try {
      if (!REDIS_URL || !REDIS_TOKEN) return null;
      const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
      const j = await r.json();
      if (j?.result == null) return null;
      try { return JSON.parse(j.result); } catch { return j.result; }
    } catch (e) { throw tagError('REDIS_GET', e); }
  }
  async function rSet(key, value, ttlSec = TTL_MAIN) {
    try {
      if (!REDIS_URL || !REDIS_TOKEN) return false;
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
      await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSec}`, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
      return true;
    } catch (e) { throw tagError('REDIS_SET', e); }
  }

  // --- GAS & Email ---
  const GAS = {
    VERIFY: process.env.GAS_VERIFY_URL,
    UPDATE: process.env.GAS_UPDATE_PROFILE_URL,
    LOGS: process.env.GAS_LOGS_URL,
    TEMAS: process.env.GAS_TEMAS_URL,
    HIST: process.env.GAS_HISTORIAL_URL,
    TEL: process.env.GAS_TELEMETRIA_URL
  };

  async function telemetry({ usuario, ms, status, detalle }) {
    if (!GAS.TEL) return;
    const payload = { fecha: new Date().toISOString(), usuario: usuario || 'anon', ruta: routeLabel, ms, status, detalle: String(detalle || '') };
    try { await fetchTimeout(GAS.TEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 12000, 1); } catch {}
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
    try { await fetchTimeout(GAS.LOGS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 12000, 1); } catch {}
  }

  async function sendEmail({ to, subject, text }) {
    try {
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
      }, 12000, 1);
      return r.ok;
    } catch (e) { throw tagError('SENDGRID', e); }
  }

  // --- Keys de caché ---
  const K_LIC = (codigo) => `lic:${String(codigo || '').toUpperCase()}`;
  const K_USR = (email) => `usr:${String(email || '').toLowerCase()}`;
  const K_TEM = (tipo) => `temas:${String(tipo || '').toLowerCase()}`; // social|empresa|educacion
  const K_BKP = (email) => `bkpperfil:${String(email || '').toLowerCase()}`;

  // --- OpenAI ---
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_COST = Number(process.env.OPENAI_COST_PER_TOKEN_USD || '0.000005');

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
- Responde SOLO el JSON sin texto adicional, sin comentarios ni explicaciones fuera del JSON.
- "mensajeUsuario": máx 100 palabras, profesional TCC+Neuro, cálido pero NO complaciente; invita a insight y siguiente paso realista SOLO si es necesario.
- Forzar mapeo a UNO de los temas PERMITIDOS. Si no hay mapeo clínicamente defendible, usar "Otro: <tema>".
- "calificacionesPorTema": entero 0–100 para CADA uno de los 11 temas PERMITIDOS (0 si no presenta señales).
- "porcentaje": certeza (0–100) de "temaDetectado".
- "SOS": "ALERTA" ante riesgo agudo (ideación/plan/intento suicida, daño a terceros, psicosis activa, violencia severa, consumo con riesgo inmediato); el mensaje debe ser más directivo pero con acompañamiento.
- Precisión clínica; nada de clichés o placebo.
`.trim();
  }

  async function callOpenAI({ prompt }) {
    try {
      const req = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      };
      let r = await fetchTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      }, 30000, 0);
      let data = await r.json().catch(() => ({}));
      if (!data?.choices?.[0]?.message?.content) {
        r = await fetchTimeout('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(req)
        }, 30000, 0);
        data = await r.json().catch(() => ({}));
        if (!data?.choices?.[0]?.message?.content) throw new Error('Respuesta vacía de OpenAI');
      }
      let json;
      try { json = JSON.parse(data.choices[0].message.content); }
      catch { throw new Error('Formato inválido (no JSON)'); }
      const usage = data.usage || {};
      const costo = usage.total_tokens ? Number((usage.total_tokens * OPENAI_COST).toFixed(6)) : 0;
      return { json, usage, costo };
    } catch (e) { throw tagError('OPENAI', e); }
  }

  // --- Utilidades de negocio ---
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

  // --- Temas por institución (tolerante) ---
  async function obtenerTemas(tipoInstitucion) {
    const key = K_TEM(tipoInstitucion);
    const cached = await rGet(key).catch(e => { throw e; });
    if (Array.isArray(cached) && cached.length) return cached;

    try {
      const r = await fetchTimeout(GAS.TEMAS, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipoInstitucion })
      }, 12000, 1);

      let data;
      try { data = await r.json(); } catch { data = null; }

      let lista = [];
      if (Array.isArray(data?.temas)) lista = data.temas;
      else if (Array.isArray(data?.lista)) lista = data.lista;
      else if (data && typeof data === 'object') {
        const k = String(tipoInstitucion || '').toLowerCase();
        if (Array.isArray(data[k])) lista = data[k];
      }

      lista = (lista || []).map(x => String(x || '').trim()).filter(Boolean);

      if (!Array.isArray(lista) || !lista.length) {
        await telemetry({ usuario: 'system', ms: 0, status: 'WARN', detalle: `obtenerTemas vacío para ${tipoInstitucion}` });
        return [];
      }
      await rSet(key, lista, TTL_MAIN);
      return lista;
    } catch (e) { throw tagError('GAS_TEMAS', e); }
  }

  async function verificarCodigoUsuario({ email, codigo }) {
    try {
      const r = await fetchTimeout(GAS.VERIFY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, codigo })
      }, 12000, 2);
      return await r.json();
    } catch (e) { throw tagError('GAS_VERIFY', e); }
  }

  async function actualizarGAS(payload) {
    try {
      const r = await fetchTimeout(GAS.UPDATE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 12000, 2);
      return await r.json();
    } catch (e) { throw tagError('GAS_UPDATE', e); }
  }

  try {
    // --- diagnóstico/versión ---
    if (action === 'version') {
      const flags = {
        FRONTEND_ORIGIN: !!process.env.FRONTEND_ORIGIN,
        OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        UPSTASH_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
        SENDGRID: !!process.env.SENDGRID_API_KEY,
        GAS_VERIFY: !!GAS.VERIFY,
        GAS_UPDATE: !!GAS.UPDATE,
        GAS_LOGS: !!GAS.LOGS,
        GAS_TEMAS: !!GAS.TEMAS,
        GAS_HIST: !!GAS.HIST,
        GAS_TEL: !!GAS.TEL
      };
      return res.status(200).json({ ok: true, flags, now: new Date().toISOString() });
    }

    if (!action) return res.status(400).json({ ok: false, error: 'action inválida' });

    // --- registro ---
    if (action === 'registro') {
      const { codigo } = body || {};
      if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });

      const licKey = K_LIC(codigo);
      let lic = await rGet(licKey).catch(() => null);
      if (!lic) {
        const ver = await verificarCodigoUsuario({ email: null, codigo });
        if (!ver?.ok) return res.status(400).json({ ok: false, error: ver?.motivo || 'Código inválido', debug: DEBUG ? { origen: 'GAS_VERIFY', ver } : undefined });
        lic = {
          codigo: String(codigo).toUpperCase(),
          activo: ver?.codigoActivo ?? true,
          disponibles: ver?.licenciasDisponibles ?? null,
          tipoInstitucion: ver?.tipoInstitucion || null,
          correoSOS: ver?.correoSOS || null,
          institucion: ver?.institucion || null
        };
        await rSet(licKey, lic, TTL_MAIN).catch(() => {});
      }
      if (lic?.tipoInstitucion) { try { await obtenerTemas(lic.tipoInstitucion); } catch (e) { if (DEBUG) console.log('WARN warmTemas:', e?.message); } }
      return res.status(200).json({ ok: true, licencia: lic });
    }

    // --- login ---
    if (action === 'login') {
      const { email, codigo } = body || {};
      if (!email || !codigo) return res.status(400).json({ ok: false, error: 'email y codigo requeridos' });

      const ver = await verificarCodigoUsuario({ email, codigo });
      if (!ver?.ok || !ver?.acceso) {
        return res.status(403).json({ ok: false, error: ver?.motivo || 'Acceso denegado', debug: DEBUG ? { origen: 'GAS_VERIFY', ver } : undefined });
      }

      const usuario = ver?.usuario || {};
      const lic = {
        codigo: String(codigo).toUpperCase(),
        activo: ver?.codigoActivo ?? true,
        disponibles: ver?.licenciasDisponibles ?? null,
        tipoInstitucion: ver?.tipoInstitucion || null,
        correoSOS: ver?.correoSOS || null,
        institucion: ver?.institucion || null
      };
      await rSet(K_LIC(codigo), lic, TTL_MAIN).catch(() => {});
      await rSet(K_USR(email), {
        nombre: usuario?.nombre || '',
        edad: usuario?.edad || usuario?.fechaNacimiento || '',
        perfilEmocional: usuario?.perfilEmocional || null,
        institucion: lic.institucion,
        tipoInstitucion: lic.tipoInstitucion,
        correoSOS: lic.correoSOS,
        correoEmergencia: usuario?.correoEmergencia || null
      }, TTL_MAIN).catch(() => {});

      if (lic?.tipoInstitucion) {
        try { await obtenerTemas(lic.tipoInstitucion); }
        catch (e) { await telemetry({ usuario: email || 'anon', ms: Date.now() - t0, status: 'WARN', detalle: `warmTemas fallo: ${String(e?.message || e)}` }); }
      }

      const awMarcado = ver?.testYaEnviado || false;
      (async () => {
        try {
          if (!awMarcado) {
            await actualizarGAS({ modo: 'ANALISIS_INICIAL', email, codigo: lic.codigo, tipoInstitucion: lic.tipoInstitucion });
            const asunto = 'Bienvenido/a a AUREA. Este es el resultado de tu test.';
            const textoU = `Hola,\n\nTu análisis inicial está siendo procesado. Recibirás tu perfil en breve.\n\n— AUREA`;
            await sendEmail({ to: email, subject: asunto, text: textoU });
            if (lic.correoSOS) await sendEmail({ to: lic.correoSOS, subject: asunto, text: `Se procesó el test de ${email}` });
            await sendEmail({ to: 'alfredo@positronconsulting.com', subject: asunto, text: `Se procesó el test de ${email}` });
          }
        } catch (_) {}
      })();

      return res.status(200).json({
        ok: true,
        acceso: true,
        usuario: {
          email,
          nombre: usuario?.nombre || '',
          edad: usuario?.edad || usuario?.fechaNacimiento || '',
          perfilEmocional: usuario?.perfilEmocional || null,
          institucion: lic.institucion,
          tipoInstitucion: lic.tipoInstitucion,
          correoSOS: lic.correoSOS,
          correoEmergencia: usuario?.correoEmergencia || null
        }
      });
    }

    // --- chat ---
    if (action === 'chat') {
      const { email, nombre, codigo, tipoInstitucion, mensaje, perfilActual } = body || {};
      if (!mensaje || !tipoInstitucion) return res.status(400).json({ ok: false, error: 'mensaje y tipoInstitucion requeridos' });

      const temas = await obtenerTemas(tipoInstitucion);
      const prompt = buildPrompt({ nombre, mensaje, temas });

      const { json, usage, costo } = await callOpenAI({ prompt });
      await logTokens({ usuario: email || 'anon', institucion: '', usage, costoUSD: costo });

      const tema = String(json?.temaDetectado || '').trim();
      const porcentaje = Math.max(0, Math.min(100, Number(json?.porcentaje || 0)));
      const califMap = normalizarCalifMap(temas.length ? temas : Object.keys(json?.calificacionesPorTema || {}), json?.calificacionesPorTema);
      const SOS = String(json?.SOS || 'OK').toUpperCase() === 'ALERTA' ? 'ALERTA' : 'OK';
      const mensajeUsuario = String(json?.mensajeUsuario || '').trim();

      const perfilNuevo = { ...(perfilActual || {}) };
      let notas = '';
      const temaValido = temas.includes(tema);

      if (!temaValido) {
        if (tema && /^Otro:/i.test(tema)) notas = tema;
        else if (tema) notas = `Otro: ${tema}`;
      } else if (porcentaje >= 60) {
        const actual = Number(perfilNuevo[tema] || 0);
        const sugerida = Number(califMap[tema] || 0);
        perfilNuevo[tema] = ema6040(actual, sugerida);
      }

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
          }, 12000, 1);
        } catch (_) {}
      }

      await telemetry({ usuario: email || 'anon', ms: Date.now() - t0, status: 'OK', detalle: 'chat' });

      return res.status(200).json({
        ok: true,
        mensajeUsuario: mensajeUsuario || 'Gracias por compartir. Estoy contigo.',
        temaDetectado: temaValido ? tema : '',
        porcentaje,
        calificacionesPorTema: califMap,
        SOS,
        notas,
        perfilSugerido: perfilNuevo
      });
    }

    // --- finalizar ---
    if (action === 'finalizar') {
      const { email, codigo, perfilCompleto, notas } = body || {};
      if (!email || !codigo || !perfilCompleto) {
        return res.status(400).json({ ok: false, error: 'email, codigo y perfilCompleto requeridos' });
      }
      try {
        const r = await actualizarGAS({
          modo: 'GUARDAR_PERFIL_FINAL',
          email,
          codigo: String(codigo).toUpperCase(),
          perfil: perfilCompleto,
          notas: notas || ''
        });
        if (!r?.ok) throw new Error('GAS no confirmó guardado');
        await telemetry({ usuario: email, ms: Date.now() - t0, status: 'OK', detalle: 'finalizar' });
        return res.status(200).json({ ok: true, guardado: true });
      } catch (e) {
        await rSet(K_BKP(email), { email, codigo, perfilCompleto, notas: notas || '', fecha: new Date().toISOString() }, TTL_BACKUP).catch(() => {});
        await telemetry({ usuario: email, ms: Date.now() - t0, status: 'BKP', detalle: 'finalizar->backup' });
        return res.status(200).json({ ok: true, guardado: false, backup: true });
      }
    }

    // --- temas (diagnóstico opcional) ---
    if (action === 'temas') {
      const { tipoInstitucion } = body || {};
      if (!tipoInstitucion) return res.status(400).json({ ok: false, error: 'tipoInstitucion requerido' });
      const temas = await obtenerTemas(tipoInstitucion);
      return res.status(200).json({ ok: true, temas });
    }

    return res.status(400).json({ ok: false, error: 'action inválida' });

  } catch (err) {
    // Telemetría
    await telemetry({ usuario: body?.email || 'anon', ms: Date.now() - t0, status: 'ERR', detalle: String(err?.message || err) });

    // Mensaje amable
    const friendly = 'A veces la tecnología y yo no hablamos exactamente el mismo idioma y ocurren pequeñas fallas de comunicación. Reintentemos: si vuelve a pasar, cuéntame de nuevo en tus palabras qué te preocupa. Estoy contigo.';

    // En DEBUG devolvemos más contexto para aislar el 500 al primer intento
    if (DEBUG) {
      const tag = err?._tag || 'UNKW';
      const rawMsg = err?._raw?.message || err?.message || String(err);
      return res.status(500).json({
        ok: false,
        error: 'Error interno',
        tag,
        detail: rawMsg,
        stack: err?.stack?.split('\n').slice(0, 3).join(' | '),
        friendly
      });
    }
    return res.status(500).json({ ok: false, error: 'Error interno', friendly });
  }
}
