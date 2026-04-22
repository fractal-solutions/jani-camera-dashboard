const baseUrl = process.env.BASE_URL ?? "http://localhost:10101";

async function post(path: string, jsonBody: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const heartbeat = await Bun.file("sample-payloads/heartbeat.json").json();
  const addPayload = await Bun.file("sample-payloads/dataUpload-add.json").json();
  const totalPayload = await Bun.file("sample-payloads/dataUpload-total.json").json();

  console.log("POST /api/camera/heartBeat");
  console.log(await post("/api/camera/heartBeat", heartbeat));

  console.log("POST /api/camera/dataUpload (Add)");
  console.log(await post("/api/camera/dataUpload", addPayload));

  console.log("POST /api/camera/dataUpload (Total)");
  console.log(await post("/api/camera/dataUpload", totalPayload));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
