export const config = {
  api: {
    bodyParser: false, // 🔥 Desactivamos bodyParser para leer todo manualmente
  },
};

import { IncomingMessage } from "http";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  // ⏳ Leer el cuerpo crudo
  let rawBody = "";
  req.on("data", chunk => {
    rawBody += chunk.toString();
  });

  req.on("end", () => {
    console.log("📥 RAW BODY RECIBIDO:");
    console.log(rawBody);

    let parsed;
    try {
      parsed = JSON.parse(rawBody); // intenta parsear como JSON
    } catch {
      parsed = Object.fromEntries(new URLSearchParams(rawBody)); // si no es JSON, parsea como formulario
    }

    console.log("📊 PARSEADO:");
    console.log(JSON.stringify(parsed, null, 2));

    res.status(200).json({
      ok: true,
      crudo: rawBody,
      parsed,
    });
  });
}
