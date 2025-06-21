// app/api/aurea/route.js
export async function POST(req) {
  // Tu lógica...
  return new Response(JSON.stringify({ message: "OK" }), {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "https://www.positronconsulting.com",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://www.positronconsulting.com",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
