// pages/api/orquestador.js
// AUREA Orquestador — Registro, Login, Temas, Chat, Finalizar
// Requiere (Vercel → Environment Variables):
// FRONTEND_ORIGIN=https://www.positronconsulting.com
// OPENAI_API_KEY=...
// UPSTASH_REDIS_REST_URL=...         (opcional, pero recomendado)
// UPSTASH_REDIS_REST_TOKEN=...       (opcional, pero recomendado)
// SENDGRID_API_KEY=...               (opcional, solo si envías correos)
// GAS_VERIFY_URL=...                 (VerificarCodigoYUsuario.gs — recibe {correo, codigo})
// GAS_UPDATE_PROFILE_URL=...         (ActualizarCalificacion/Perfil — recibe { modo:'GUARDAR_PERFIL_FINAL', correo, codigo, perfil, notas })
// GAS_LOGS_URL=...                   (registrarTokens.gs — { fecha, usuario, ... })
// GAS_TEMAS_URL=...                  (OPCIONAL: Web App que devuelva { ok:true, temas:[...] })
// GAS_HISTORIAL_URL=...              (guardarHistorial.gs — SOS, etc.)
// GAS_TELEMETRIA_URL=...             (Telemetria.gs)

export default async function handler(req, res) {
  // ---------- CORS ----------
  const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug, X-Debug-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const { action } = (req.query || {});
  const body = req.body || {};
  const t0 = Date.now();

  // ---------- Helpers ----------
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchTimeout(url, options = {}, timeoutMs = 12000, retries = 1, backoff = 500) {
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

  // ---------- GAS ----------
  const GAS = {
    VERIFY: process.env.GAS_VERIFY_URL || '',
    UPDATE: process.env.GAS_UPDATE_PROFILE_URL || '',
    LOGS: process.env.GAS_LOGS_URL || '',
    TEMAS: process.env.GAS_TEMAS_URL || '',
    HIST: process.env.GAS_HISTORIAL_URL || '',
    TEL: process.env.GAS_TELEMETRIA_URL || ''
  };

  // ---------- Redis (Upstash) ----------
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  const TTL_MAIN = 60 * 60;        // 60 min
  const TTL_BACKUP = 24 * 60 * 60; // 24 h

  async function rGet(key) {
    if (!REDIS_URL || !REDIS_TOKEN) return null;
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const j = await r.json().catch(() => ({}));
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

  // ---------- Keys ----------
  const K_LIC = (codigo) => `lic:${String(codigo || '').toUpperCase()}`;
  const K_USR = (correo) => `usr:${String(correo || '').toLowerCase()}`;
  const K_TEM = (tipo) => `temas:${String(tipo || '').toLowerCase()}`;
  const K_BKP = (correo) => `bkpperfil:${String(correo || '').toLowerCase()}`;

  // ---------- Telemetría / Logs ----------
  async function telemetry({ usuario, ms, status, detalle }) {
    if (!GAS.TEL) return;
    const payload = { fecha: new Date().toISOString(), usuario: usuario || 'anon', ruta: `orq/${action || 'none'}`, ms, status, detalle: String(detalle || '') };
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

  // ---------- Fallback de Temas (define aquí tus 11 por institución o via ENV) ----------
  const DEFAULT_TEMAS = {
    social: (process.env.DEFAULT_TEMAS_SOCIAL || 'Ansiedad|Depresión|Estrés|Autoestima|Relaciones|Duelo|Ira|Hábitos|Sueño|Motivación|Comunicación')
      .split('|').map(s => s.trim()).filter(Boolean),
    empresa: (process.env.DEFAULT_TEMAS_EMPRESA || 'Burnout|Estrés laboral|Liderazgo|Trabajo en equipo|Comunicación|Productividad|Conflictos|Cambio|Motivación|Toma de decisiones|Gestión del tiempo')
      .split('|').map(s => s.trim()).filter(Boolean),
    educacion: (process.env.DEFAULT_TEMAS_EDUCACION || 'Ansiedad académica|Procrastinación|Hábitos de estudio|Sueño|Atención|Memoria|Autoeficacia|Relaciones|Bullying|Autocuidado|Motivación')
      .split('|').map(s => s.trim()).filter(Boolean),
  };

  async function obtenerTemas(tipoInstitucion) {
    const key = K_TEM(tipoInstitucion);
    // cache
    try {
      const cached = await rGet(key);
      if (Array.isArray(cached) && cached.length) return cached;
    } catch {}

    // GAS (si tu Web App devuelve { ok:true, temas:[...] })
    try {
      if (GAS.TEMAS) {
        const r = await fetchTimeout(GAS.TEMAS, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipoInstitucion })
        }, 12000, 1);
        let data = await r.json().catch(() => ({}));
        let lista = [];
        if (Array.isArray(data?.temas)) lista = data.temas;
        // normaliza
        lista = (lista || []).map(x => String(x || '').trim()).filter(Boolean);
        if (lista.length) {
          await rSet(key, lista, TTL_MAIN).catch(()=>{});
          return lista;
        }
      }
    } catch {}

    // Fallback local
    const fb = DEFAULT_TEMAS[String(tipoInstitucion || '').toLowerCase()] || [];
    if (fb.length) await rSet(key, fb, TTL_MAIN).catch(()=>{});
    return fb;
  }

  // ---------- OpenAI ----------
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
  const OPENAI_COST = Number(process.env.OPENAI_COST_PER_TOKEN_USD || '0.000005');

  function buildPrompt({ nombre, mensaje, temas }) {
    const lista = (Array.isArray(temas) && temas.length)
      ? temas.join(', ')
      : 'Ansiedad, Depresión, Burnout, Violencia Intrafamiliar, Aislamiento Social, Abuso sexual, Violencia de Género, Psicosis, Trastornos de Conducta, Consumo de Sustancias, Suicidio';

    return `
Eres AUREA, psicoterapeuta especializado en Terapia Cognitivo Conductual (TCC) y Neurociencia.

Debes responder EXCLUSIVAMENTE en JSON válido con EXACTAMENTE estas claves:
{
  "mensajeUsuario": "string",                // máximo 100 palabras. Tono profesional, cálido, empático pero que RETE (TCC + Neuro). Nunca complaciente.
  "temaDetectado": "string",                 // elige 1 de la lista PERMITIDA o "Otro: <tema>"
  "porcentaje": 0-100,                       // entero, confianza en la clasificación
  "calificacionesPorTema": {                 // mapa con TODOS los 11 temas de la institución
    "<Tema1>": 0-100,
    "<Tema2>": 0-100,
    "...": 0-100
  },
  "SOS": "OK" | "ALERTA"                     // "ALERTA" si riesgo agudo (suicidio, psicosis activa, violencia severa, consumo con riesgo inmediato)
}

Contexto del usuario:
- Nombre: ${nombre || 'Usuario'}
- Mensaje: "${String(mensaje || '').replace(/"/g, '\\"')}"

Lista de TEMAS PERMITIDOS:
${lista}

Instrucciones clínicas (OBLIGATORIAS):
- Responde SOLO con el JSON, sin texto adicional.
- "mensajeUsuario": máximo 100 palabras, estilo TCC y Neurociencia: directo, claro, empático y RETADOR.
- "temaDetectado": siempre elegir 1 de la lista. Si no hay relación clínica fuerte, usar "Otro: <tema>".
- "calificacionesPorTema": asigna SIEMPRE un entero entre 0–100 para cada tema (0 si no hay señales).
- "porcentaje": tu mejor estimación clínica de confianza (entero).
- "SOS": pon "ALERTA" si detectas riesgo inminente de suicidio, violencia o psicosis activa.
- Evita frases cliché o placebo. Mantén precisión clínica, estilo profesional y acompañamiento real.
- Si hay fallas de comunicación, recuerda amablemente que "a veces no hablamos el mismo idioma".
`.trim();
  }

  async function callOpenAI({ prompt }) {
    const req = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: 'json_object' }
    };
    const r = await fetchTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    }, 30000, 0);
    const data = await r.json().catch(() => ({}));
    if (!data?.choices?.[0]?.message?.content) throw new Error('Respuesta vacía de OpenAI');
    let json;
    try { json = JSON.parse(data.choices[0].message.content); }
    catch { throw new Error('Formato inválido (no JSON)'); }
    const usage = data.usage || {};
    const costo = usage.total_tokens ? Number((usage.total_tokens * OPENAI_COST).toFixed(6)) : 0;
    return { json, usage, costo };
  }

  // ---------- Utilidades de negocio ----------
  function ema6040(actual, nuevo) {
    const a = Number(actual || 0);
    const n = Math.max(0, Math.min(100, Number(nuevo || 0)));
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

  // ---------- GAS wrappers ----------
  async function verificarCodigoUsuario({ correo, codigo }) {
    if (!GAS.VERIFY) throw new Error('GAS_VERIFY_URL no configurado');
    const r = await fetchTimeout(GAS.VERIFY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, codigo })
    }, 12000, 2);
    return r.json();
  }
  async function actualizarPerfilGAS(payload) {
    if (!GAS.UPDATE) throw new Error('GAS_UPDATE_PROFILE_URL no configurado');
    const r = await fetchTimeout(GAS.UPDATE, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 12000, 2);
    return r.json();
  }

  try {
    // ---------- version (diagnóstico rápido) ----------
    if (action === 'version') {
      return res.status(200).json({
        ok: true,
        flags: {
          FRONTEND_ORIGIN: !!process.env.FRONTEND_ORIGIN,
          OPENAI_API_KEY: !!OPENAI_API_KEY,
          UPSTASH_URL: !!REDIS_URL,
          UPSTASH_TOKEN: !!REDIS_TOKEN,
          SENDGRID: !!process.env.SENDGRID_API_KEY,
          GAS_VERIFY: !!GAS.VERIFY,
          GAS_UPDATE: !!GAS.UPDATE,
          GAS_LOGS: !!GAS.LOGS,
          GAS_TEMAS: !!GAS.TEMAS,
          GAS_HIST: !!GAS.HIST,
          GAS_TEL: !!GAS.TEL
        },
        now: new Date().toISOString()
      });
    }

    // ---------- registro ----------
    // Nota: tu GAS de verificación exige {correo,codigo}. En registro NO tienes correo.
    // Implementamos un flujo tolerante: inferimos tipo por heurística y/o cache de licencia.
    if (action === 'registro') {
      const { codigo } = body || {};
      if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });

      // Intenta recuperar de caché si ya se hizo login antes y quedó la licencia.
      const licCache = await rGet(K_LIC(codigo)) || {};
      let tipo = String(licCache.tipoInstitucion || '').toLowerCase();
      let institucion = licCache.institucion || '';
      let correoSOS = licCache.correoSOS || '';

      // Heurística mínima si no hay cache
      if (!tipo) {
        const upper = String(codigo).toUpperCase();
        if (/_EMP\b/.test(upper) || /EMPRESA/i.test(upper)) tipo = 'empresa';
        else if (/_SOC\b/.test(upper) || /SOCIAL/i.test(upper)) tipo = 'social';
        else if (/_EDU\b/.test(upper) || /EDU/i.test(upper) || /EDUC/i.test(upper)) tipo = 'educacion';
      }

      // Si aún no tenemos tipo, manda social por defecto (evitas bloqueo en UX)
      if (!tipo) tipo = 'social';

      // precalienta temas (no bloqueante)
      try { await obtenerTemas(tipo); } catch {}

      // Respuesta tipo “licencia”
      const licencia = {
        codigo: String(codigo).toUpperCase(),
        activo: true,
        disponibles: null,
        tipoInstitucion: tipo,
        correoSOS,
        institucion
      };
      await rSet(K_LIC(codigo), licencia, TTL_MAIN).catch(()=>{});
      return res.status(200).json({ ok: true, licencia });
    }

    // ---------- login ----------
    if (action === 'login') {
      const { email, codigo } = body || {};
      if (!email || !codigo) return res.status(400).json({ ok: false, error: 'correo y codigo requeridos' });

      // GAS verificar (usa 'correo', no 'email')
      const ver = await verificarCodigoUsuario({ correo: email, codigo });
      if (!ver?.ok || !ver?.acceso) {
        return res.status(403).json({ ok: false, error: ver?.motivo || 'Acceso denegado' });
      }

      const lic = {
        codigo: String(codigo).toUpperCase(),
        activo: true,
        disponibles: null,
        tipoInstitucion: ver?.tipoInstitucion || '',
        correoSOS: ver?.correoSOS || '',
        institucion: ver?.institucion || ''
      };
      await rSet(K_LIC(codigo), lic, TTL_MAIN).catch(()=>{});

      // precalienta temas (tolerante)
      if (lic.tipoInstitucion) { try { await obtenerTemas(lic.tipoInstitucion); } catch {} }

      return res.status(200).json({
        ok: true,
        acceso: true,
        usuario: ver?.usuario || {},
        institucion: lic.institucion,
        tipoInstitucion: lic.tipoInstitucion
      });
    }

    // ---------- temas ----------
    if (action === 'temas') {
      const { tipoInstitucion } = body || {};
      if (!tipoInstitucion) return res.status(400).json({ ok: false, error: 'tipoInstitucion requerido' });
      const temas = await obtenerTemas(tipoInstitucion);
      return res.status(200).json({ ok: true, temas });
    }

    // ---------- chat ----------
    if (action === 'chat') {
      const { email, nombre, codigo, tipoInstitucion, mensaje, perfilActual } = body || {};
      if (!mensaje || !tipoInstitucion) return res.status(400).json({ ok: false, error: 'mensaje y tipoInstitucion requeridos' });

      const temas = await obtenerTemas(tipoInstitucion); // puede venir de GAS o fallback
      const prompt = buildPrompt({ nombre, mensaje, temas });

      const { json, usage, costo } = await callOpenAI({ prompt });
      await logTokens({ usuario: email || 'anon', institucion: '', usage, costoUSD: costo });

      const tema = String(json?.temaDetectado || '').trim();
      const porcentaje = Math.max(0, Math.min(100, Number(json?.porcentaje || 0)));
      const califMap = normalizarCalifMap(temas.length ? temas : Object.keys(json?.calificacionesPorTema || {}), json?.calificacionesPorTema);
      const SOS = String(json?.SOS || 'OK').toUpperCase() === 'ALERTA' ? 'ALERTA' : 'OK';
      const mensajeUsuario = String(json?.mensajeUsuario || '').trim();

      // Perfil sugerido (EMA 60/40) solo si tema ∈ temas y porcentaje ≥ 60
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
          }, 12000, 1);
        } catch {}
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

    // ---------- finalizar ----------
    if (action === 'finalizar') {
      const { correo, codigo, perfilCompleto, notas } = body || {};
      if (!correo || !codigo || !perfilCompleto) {
        return res.status(400).json({ ok: false, error: 'correo, codigo y perfilCompleto requeridos' });
      }
      try {
        const r = await actualizarPerfilGAS({
          modo: 'GUARDAR_PERFIL_FINAL',
          correo,
          codigo: String(codigo).toUpperCase(),
          perfil: perfilCompleto,
          notas: notas || ''
        });
        if (!r?.ok) throw new Error('GAS no confirmó guardado');
        await telemetry({ usuario: correo, ms: Date.now() - t0, status: 'OK', detalle: 'finalizar' });
        return res.status(200).json({ ok: true, guardado: true });
      } catch (err) {
        // Backup en Redis 24h
        await rSet(K_BKP(correo), { correo, codigo, perfilCompleto, notas: notas || '', fecha: new Date().toISOString() }, TTL_BACKUP).catch(()=>{});
        await telemetry({ usuario: correo, ms: Date.now() - t0, status: 'BKP', detalle: 'finalizar->backup' });
        return res.status(200).json({ ok: true, guardado: false, backup: true });
      }
    }

    // ---------- default ----------
    return res.status(400).json({ ok: false, error: 'action inválida' });

  } catch (err) {
    await telemetry({ usuario: body?.email || body?.correo || 'anon', ms: Date.now() - t0, status: 'ERR', detalle: String(err?.message || err) });
    const friendly = 'A veces la tecnología y yo no hablamos exactamente el mismo idioma y ocurren pequeñas fallas de comunicación. Reintentemos: si vuelve a pasar, cuéntame de nuevo en tus palabras qué te preocupa. Estoy contigo.';
    return res.status(500).json({ ok: false, error: 'Error interno', friendly });
  }
}
