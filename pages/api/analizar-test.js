import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const API_RESPUESTAS = "https://script.google.com/macros/s/AKfycbzAWKtMoGimqSjdkbbnQGcr3aMm7POiwoJbMoVJKVnWjkCim4qx5cn2c57UCMlFzCCL/exec";
const API_ENVIAR_CORREO = "https://aurea-backend-two.vercel.app/api/enviar-correo";
const API_TOKENS = "https://script.google.com/macros/s/AKfycbyHn1qrFocq0pkjujypoB-vK7MGmGFz6vH4t2qVfHcziTcuMB3abi3UegPGdNno3ibULA/exec";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const { tipoInstitucion, correoSOS } = req.body;
    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);

    // 1. Obtener respuestas del Apps Script
    const respuestaRaw = await fetch(API_RESPUESTAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });
    const datos = await respuestaRaw.json();
    if (!datos.ok) return res.status(500).json({ ok: false, error: "Error al obtener respuestas del test" });

    const { usuario: correo, nombre, sexo, fechaNacimiento, info, respuestas } = datos;

    const usuario = {
    correo,
    nombre
    };


    // 2. Crear prompt (NO CAMBIADO)
    const prompt = `
Eres AUREA, la mejor psicóloga del mundo, con entrenamiento clínico avanzado en psicometría, salud mental y análisis emocional. Acabas de aplicar un test inicial a ${usuario.nombre}, de genero ${sexo} y con fecha de nacimiento ${fechaNacimiento}, quien respondió una serie de reactivos tipo Likert ("Nunca", "Casi nunca", "A veces", "Casi siempre", "Siempre") sobre diversos temas emocionales.

A continuación se presentan las respuestas al test (formato JSON):
${JSON.stringify(respuestas, null, 2)}

El usuario también escribió este comentario libre:
"${info}"

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

    // 3. Llamar a OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const contenido = completion.choices[0].message.content;
    let evaluacion;
    try {
      evaluacion = JSON.parse(contenido);
    } catch (error) {
      console.error("❌ Error al parsear JSON desde OpenAI. Respuesta completa:\n" + contenido);
      return res.status(500).json({ ok: false, error: "Respuesta de OpenAI no es JSON válido" });
    }

    const { perfil, alertaSOS = false, temaDetectado = "" } = evaluacion;

    // ✅ 4. Llamar a enviar-correo (agregando nombre completo)
    const correoRaw = await fetch(API_ENVIAR_CORREO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario,
        tipoInstitucion,
        perfil,
        alertaSOS,
        temaDetectado,
        correoSOS
      })
    });
    const resultadoCorreo = await correoRaw.json();
    if (!resultadoCorreo.ok) {
      console.error("❌ Error al enviar correo:", resultadoCorreo.error);
    }

    // 5. OK
    res.status(200).json({ ok: true });

    // 6. Registrar tokens
    try {
      const { prompt_tokens, completion_tokens, total_tokens } = completion.usage;
      await fetch(API_TOKENS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: new Date().toISOString(),
          usuario,
          institucion: tipoInstitucion,
          inputTokens: prompt_tokens,
          outputTokens: completion_tokens,
          totalTokens: total_tokens,
          costoUSD: (total_tokens / 1000 * 0.01).toFixed(4)
        })
      });
    } catch (error) {
      console.error("⚠️ Error al registrar tokens:", error.message);
    }

  } catch (err) {
    console.error("🔥 Error en analizar-test.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
