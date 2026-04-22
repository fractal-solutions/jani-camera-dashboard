export async function readJson(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Response(JSON.stringify({ code: 400, msg: "content-type must be application/json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    return await req.json();
  } catch {
    throw new Response(JSON.stringify({ code: 400, msg: "invalid json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
}

