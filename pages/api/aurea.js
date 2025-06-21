export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "POST") {
    // Aquí va la lógica de respuesta de AUREA
    const { prompt } = req.body;
    res.status(200).json({ reply: `Procesado: ${prompt}` });
  } else {
    res.status(405).end();
  }
}
