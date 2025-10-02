// pages/api/orquestador.js
// Orquestador único AUREA (registro, login, chat, finalizar, temas dinámicos)
// ENV requeridas:
// FRONTEND_ORIGIN=https://www.positronconsulting.com
// OPENAI_API_KEY=...
// UPSTASH_REDIS_REST_URL=...
// UPSTASH_REDIS_REST_TOKEN=...
// SENDGRID_API_KEY=...
// GAS_VERIFY_URL=https://script.google.com/macros/s/AKfycbwDMJb1IJ5H-rFOqg2F-PMQKtUclaD5Z7pFPAraeHpE9VB8srzuAtV4ui9Gb9SnlzDgmA/exec
// GAS_UPDATE_PROFILE_URL=https://script.google.com/macros/s/AKfycbxX1DxhOCvnYJx--A-HsS0n6c-NSThpu67HX7-KCY5IMaVUGHQZGBmXui0xgfQHFZmizw/exec
// GAS_LOGS_URL=https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec
// GAS_TEMAS_URL=https://script.google.com/macros/s/AKfycbzJ1hbX6tMRA7qmd9JTRqDNQ9m46LBLqadXQu5Z87wfTeYrxhakC4vqoVtD9zHwwVy5bw/exec
// GAS_HISTORIAL_URL=https://script.google.com/macros/s/AKfycbyZ6AQsGRmRjiKe3BHOiy_qCELP8tTDhU4eTC4PNJnAlQ5Pti9jytu1RCz5zCpP18Hjpw/exec
// GAS_TELEMETRIA_URL=https://script.google.com/macros/s/AKfycbyqV0EcaUb_o8c91zF4kJ7Spm2gX4ofSXcwGaN-_yzz14wgnuiNeGwILIQIKwfvzOSW1Q/exec
// OPENAI_COST_PER_TOKEN_USD=0.000005 (opcional)

export default async function handler(req, res) {
  // CORS
  const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const t0 = Date.now();
  const { action } = (req.query || {});
  const body = (req.body || {});
  const routeLabel = `orquestador/${action || 'none'}`;

  // ---- Helpers base ----
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchTimeout(url, options = {}, timeoutMs = 12000, retries = 2, backoff = 500) {
    for (let i = 0; i <= retries; i++) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(id);
        if (!r.ok) {
          if (r.status >= 500 || r.status === 429) throw new Error(`HTTP ${r.status}`);
        }
        return r;
      } catch (e) {
        clearTimeout(id);
        if (i === retries) throw e;
        await wait(backoff * Math.pow(3, i)); // 500ms, 1500ms
      }
    }
  }

  // ---- Redis (Upstash) ----
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const TTL_MAIN = 60 * 60; // 60 min
  const TTL_BACKUP = 24 * 60 * 60; // 24h

  async function rGet(key) {
    if (!REDIS_URL || !REDIS_TOKEN) return null;
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const j = await r.json();
    if (j?.result == null) return null;
    try { return JSON.parse(j.result); } catch { return j.result; }
  }
  async function rSet(key, value, ttlSec = TTL_MAIN) {
    if (!REDIS_URL || !REDIS_TOKEN) return false;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSec}`, {
      method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    return true;
  }

  // ---- GAS & Email ----
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
    try {
      await fetchTimeout(GAS.TEL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 12000, 1);
    } catch {}
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
      await fetchTimeout(GAS.LOGS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 12000, 1);
    } catch {}
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
    }, 12000, 1);
    return r.ok;
  }

  // ---- Claves de caché ----
  const K_LIC = (codigo) => `lic:${String(codigo || '').toUpperCase()}`;
  const K_USR = (email) => `usr:${String(email || '').toLowerCase()}`;
  const K_TEM = (tipo) => `temas:${String(tipo || '').toLowerCase()}`; // social|empresa|educacion
  const K_BKP = (email) => `bkpperfil:${String(email || '').toLowerCase()}`;

  // ---- OpenAI ----
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_COST = Number(process.env.OPENAI_COST_PER_TOKEN_USD || '0.000005');

  function buildPrompt({ nombre, mensaje, temas }) {
    const lista = (Array.isArray(temas) && temas.length) ? temas.join(', ') : 'Ansiedad, Depresión, Burnout';
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
- "mensajeUsuario": tono profesional TCC+Neuro, cálido pero NO complaciente; debe invitar a insight y a un siguiente paso realista SOLO si es necesario.
- Forzar mapeo a UNO de los temas PERMITIDOS. Si no hay mapeo clínicamente defendible, usar "Otro: <tema>".
- "calificacionesPorTema": entero 0–100 para CADA uno de los 11 temas PERMITIDOS (0 si no presenta señales).
- "porcentaje": mejor estimación (entero) de certeza sobre "temaDetectado".
- "SOS": "ALERTA" ante riesgo agudo (criterios clínicos estándar). En tal caso, el "mensajeUsuario" debe ser más directivo pero con acompañamiento.
- Mantén precisión clínica; evita clichés, promesas vacías y frases de placebo. Sé claro, directo y respetuoso.
`.trim();
  }

  async function callOpenAI({ prompt }) {
    // Intento 1: JSON mode
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
    let data = await r.json();
    if (!data?.choices?.[0]?.message?.content) {
      // Reintento único: reenvío completo
      r = await fetchTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      }, 30000, 0);
      data = await r.json();
      if (!data?.choices?.[0]?.message?.content) throw new Error('Respuesta vacía de OpenAI');
    }
    let json;
    try { json = JSON.parse(data.choices[0].message.content); }
    catch { throw new Error('Formato inválido (no JSON)'); }

    const usage = data.usage || {};
    const costo = usage.total_tokens ? Number((usage.total_tokens * OPENAI_COST).toFixed(6)) : 0;
    return { json, usage, costo };
  }

  // ---- Utilidades de negocio ----
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

  async function obtenerTemas(tipoInstitucion) {
    const key = K_TEM(tipoInstitucion);
    let temas = await rGet(key);
    if (Array.isArray(temas) && temas.length === 11) return temas;
    // Pedimos a GAS
    const r = await fetchTimeout(GAS.TEMAS, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoInstitucion })
    }, 12000, 1);
    const data = await r.json();
    temas = Array.isArray(data?.temas) ? data.temas.filter(Boolean) : [];
    if (temas.length !== 11) throw new Error('Temas inválidos para la institución');
    await rSet(key, temas, TTL_MAIN);
    return temas;
    }

  async function verificarCodigoUsuario({ email, codigo }) {
    const r = await fetchTimeout(GAS.VERIFY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, codigo })
    }, 12000, 2);
    return r.json();
  }

  async function actualizarGAS(payload) {
    const r = await fetchTimeout(GAS.UPDATE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 12000, 2);
    return r.json();
  }

  // --------------- Acciones ---------------
  try {
    // ----- registro -----
    if (action === 'registro') {
      const { codigo } = body || {};
      if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });

      // Verificación + cache licencia
      const licKey = K_LIC(codigo);
      let lic = await rGet(licKey);
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
        await rSet(licKey, lic, TTL_MAIN);
      }
      // Pre-cargar y cachear temas de la institución
      if (lic?.tipoInstitucion) await obtenerTemas(lic.tipoInstitucion);

      return res.status(200).json({ ok: true, licencia: lic });
    }

    // ----- login -----
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
        perfilEmocional: usuario?.perfilEmocional || null,
        institucion: lic.institucion,
        tipoInstitucion: lic.tipoInstitucion,
        correoSOS: lic.correoSOS,
        correoEmergencia: usuario?.correoEmergencia || null
      }, TTL_MAIN);

      // Warm temas
      if (lic?.tipoInstitucion) await obtenerTemas(lic.tipoInstitucion);

      // BG análisis inicial si AW != 'X'
      const awMarcado = ver?.testYaEnviado || false;
      (async () => {
        try {
          if (!awMarcado) {
            await actualizarGAS({
              modo: 'ANALISIS_INICIAL',
              email,
              codigo: lic.codigo,
              tipoInstitucion: lic.tipoInstitucion
            });
            const asunto = 'Bienvenido/a a AUREA. Este es el resultado de tu test.';
            const textoU = `Hola,\n\nTu análisis inicial está siendo procesado. Recibirás tu perfil en breve.\n\n— AUREA`;
            await sendEmail({ to: email, subject: asunto, text: textoU });
            if (lic.correoSOS) await sendEmail({ to: lic.correoSOS, subject: asunto, text: `Se procesó el test de ${email}` });
            await sendEmail({ to: 'alfredo@positronconsulting.com', subject: asunto, text: `Se procesó el test de ${email}` });
          }
        } catch { /* no bloquear */ }
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

    // ----- chat -----
    if (action === 'chat') {
      const { email, nombre, codigo, tipoInstitucion, mensaje, perfilActual } = body || {};
      if (!mensaje || !tipoInstitucion) return res.status(400).json({ ok: false, error: 'mensaje y tipoInstitucion requeridos' });

      const temas = await obtenerTemas(tipoInstitucion);
      const prompt = buildPrompt({ nombre, mensaje, temas });

      const { json, usage, costo } = await callOpenAI({ prompt });
      await logTokens({ usuario: email || 'anon', institucion: '', usage, costoUSD: costo });

      // Normalización/validación
      const tema = String(json?.temaDetectado || '').trim();
      const porcentaje = Math.max(0, Math.min(100, Number(json?.porcentaje || 0)));
      const califMap = normalizarCalifMap(temas, json?.calificacionesPorTema);
      const SOS = String(json?.SOS || 'OK').toUpperCase() === 'ALERTA' ? 'ALERTA' : 'OK';
      const mensajeUsuario = String(json?.mensajeUsuario || '').trim();

      // Perfil sugerido (EMA 60/40 solo sobre temaDetectado, si es uno de los 11 y porcentaje ≥ 60)
      const perfilNuevo = { ...(perfilActual || {}) };
      let notas = '';
      let temaValido = temas.includes(tema);

      if (!temaValido) {
        if (tema && /^Otro:/i.test(tema)) { notas = tema; }
        else if (tema) { notas = `Otro: ${tema}`; }
      } else if (porcentaje >= 60) {
        const actual = Number(perfilNuevo[tema] || 0);
        const sugerida = Number(califMap[tema] || 0);
        perfilNuevo[tema] = ema6040(actual, sugerida);
      }

      // SOS → historial
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
        } catch {}
      }

      // Telemetría
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

    // ----- finalizar -----
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
      } catch (err) {
        await rSet(K_BKP(email), { email, codigo, perfilCompleto, notas: notas || '', fecha: new Date().toISOString() }, TTL_BACKUP);
        await telemetry({ usuario: email, ms: Date.now() - t0, status: 'BKP', detalle: 'finalizar->backup' });
        return res.status(200).json({ ok: true, guardado: false, backup: true });
      }
    }

    // ----- temas (opcional diagnóstico) -----
    if (action === 'temas') {
      const { tipoInstitucion } = body || {};
      if (!tipoInstitucion) return res.status(400).json({ ok: false, error: 'tipoInstitucion requerido' });
      const temas = await obtenerTemas(tipoInstitucion);
      return res.status(200).json({ ok: true, temas });
    }

    return res.status(400).json({ ok: false, error: 'action inválida' });

  } catch (err) {
    await telemetry({ usuario: body?.email || 'anon', ms: Date.now() - t0, status: 'ERR', detalle: String(err?.message || err) });
    // Mensaje “lindo” de caída general (front lo puede mostrar si desea)
    const friendly = 'A veces la tecnología y yo no hablamos exactamente el mismo idioma y ocurren pequeñas fallas de comunicación. Reintentemos: si vuelve a pasar, cuéntame de nuevo en tus palabras qué te preocupa. Estoy contigo.';
    return res.status(500).json({ ok: false, error: 'Error interno', friendly });
  }
}
