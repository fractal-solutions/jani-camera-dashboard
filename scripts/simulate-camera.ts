const baseUrl = process.env.BASE_URL ?? "http://localhost:10101";
const sn = process.env.SN ?? "HX-CCD21-DEMO-0001";
const mode = (process.env.DATA_MODE ?? "Add") as "Add" | "Total";

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return JSON.parse(text) as any;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  console.log(`Simulating camera sn=${sn} -> ${baseUrl} mode=${mode}`);

  await post("/api/camera/heartBeat", { sn, timestamp: nowUnix(), ipAddress: "192.168.1.80", macAddress: "AA:BB:CC:DD:EE:FF" });

  let inTotal = 0;
  let outTotal = 0;
  let passTotal = 0;
  let turnTotal = 0;

  for (;;) {
    const t = nowUnix();
    const incIn = randInt(0, 5);
    const incOut = randInt(0, Math.min(incIn, 3));
    const incPass = randInt(0, 8);
    const incTurn = randInt(0, 2);

    if (mode === "Total") {
      inTotal += incIn;
      outTotal += incOut;
      passTotal += incPass;
      turnTotal += incTurn;
    }

    const payload =
      mode === "Total"
        ? {
            sn,
            startTime: t - 5,
            endTime: t,
            time: t,
            in: inTotal,
            out: outTotal,
            passby: passTotal,
            turnback: turnTotal,
            avgStayTime: randInt(20_000, 180_000),
            dataMode: "Total",
            attributes: [
              { personId: `p-${t}-1`, eventType: 0, gender: randInt(1, 2), age: [randInt(16, 35), randInt(26, 55)], height: randInt(150, 190), stayTime: randInt(10_000, 200_000) },
            ],
          }
        : {
            sn,
            startTime: t - 5,
            endTime: t,
            time: t,
            in: incIn,
            out: incOut,
            passby: incPass,
            turnback: incTurn,
            avgStayTime: randInt(20_000, 180_000),
            dataMode: "Add",
            attributes: [
              { personId: `p-${t}-1`, eventType: 0, gender: randInt(1, 2), age: [randInt(16, 35), randInt(26, 55)], height: randInt(150, 190), stayTime: randInt(10_000, 200_000) },
            ],
          };

    const resp = await post("/api/camera/dataUpload", payload);
    process.stdout.write(`dataUpload -> ${resp.msg} time=${t}\n`);
    await Bun.sleep(5_000);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
