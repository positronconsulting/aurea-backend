export default async function handler(req, res) {
  if (req.method === "POST") {
    const body = req.body;

    console.log("📥 Entrada recibida:");
    console.log(JSON.stringify(body, null, 2));

    return res.status(200).json({ ok: true, recibido: body });
  } else {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }
}
