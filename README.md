# HX-CCD21 People Counting Dashboard (Bun)

Production-oriented starter for an HX-CCD21 (AI people counting camera) backend + real-time analytics dashboard.

## Quickstart

```bash
bun install
bun run db:seed
bun dev
```

Open the dashboard at `http://localhost:3000`.

## Connect a real HX-CCD21 camera (recommended)

The HX-CCD21 **pushes** data to your server via HTTP POST (you do not "connect" to the camera from this app). Your job is to:
1) Make this server reachable on the network
2) Register the camera SN so requests aren’t rejected
3) Enter the server URLs in the camera configuration

### 1) Make the server reachable

- If the camera is on the same LAN: run the server on a machine with a LAN IP like `192.168.x.x`, and in the camera settings use that IP (not `localhost`).
- If the camera is remote: expose your server publicly (reverse proxy + TLS recommended) and use your public domain/IP.

Start the server:

```bash
bun dev
```

### 2) Register the camera SN (device authentication)

This backend **rejects unknown SNs** by design.

Option A (fast): seed/register via env + seed script

- PowerShell:
```powershell
$env:SEED_DEVICE_SN="YOUR_CAMERA_SN"; bun run db:seed
```

- bash/zsh:
```bash
SEED_DEVICE_SN="YOUR_CAMERA_SN" bun run db:seed
```

Option B (admin API): register via HTTP (requires `ADMIN_TOKEN`)

1) Set `ADMIN_TOKEN` (see `.env.example`)
2) Call:

PowerShell:

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/admin/registerDevice" `
  -Headers @{ "x-admin-token" = "YOUR_ADMIN_TOKEN" } `
  -ContentType "application/json" `
  -Body '{"sn":"YOUR_CAMERA_SN","name":"Entrance Camera","shopName":"Main Shop","dataMode":"Add"}'
```

bash/zsh (curl):

```bash
curl -X POST http://localhost:3000/api/admin/registerDevice \
  -H "content-type: application/json" \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -d '{"sn":"YOUR_CAMERA_SN","name":"Entrance Camera","shopName":"Main Shop","dataMode":"Add"}'
```

### 3) Configure the camera "server address" URLs

Set these in the HX-CCD21 configuration (from the vendor protocol PDF):

- Heartbeat URL: `http://<YOUR_SERVER_HOST>:3000/api/camera/heartBeat`
- Data upload URL: `http://<YOUR_SERVER_HOST>:3000/api/camera/dataUpload`

Examples:

- LAN: `http://192.168.1.10:3000/api/camera/heartBeat`
- Public: `https://example.com/api/camera/heartBeat` (recommended behind TLS)

## Camera API (strict)

- `POST /api/camera/heartBeat`
- `POST /api/camera/dataUpload`

Sample payloads are in `sample-payloads/`.

### Troubleshooting

- Seeing `unknown sn`: register the SN using `bun run db:seed` (Option A) or the admin endpoint (Option B).
- Dashboard loads but no data: confirm the camera is posting to the correct host/IP and the server is reachable from the camera network.

## Real-time

- WebSocket endpoint: `GET /ws`
- Events: `flow:update`, `occupancy:update`

## Database

Uses Bun built-in SQLite (`bun:sqlite`) by default.

- Migrate: `bun run db:migrate`
- Seed demo shop/device: `bun run db:seed`

DB file path: `DB_PATH` (default: `./data/app.sqlite`).

## Simulator

Send heartbeat + periodic uploads:

```bash
bun run simulate:camera
```

Optional env:

- `BASE_URL` (default `http://localhost:3000`)
- `SN` (default `HX-CCD21-DEMO-0001`)
- `DATA_MODE` (`Add` or `Total`)

## Admin (optional)

Register devices via API (requires `ADMIN_TOKEN`):

- `POST /api/admin/registerDevice` (header `x-admin-token`)
