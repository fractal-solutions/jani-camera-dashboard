# Integration API for Odoo (Read-only Metrics)

This document is intended for the Odoo team to pull metrics for dashboards.

It focuses on **read-only** endpoints (no device deletion, no admin actions).

Base URL (default dev): `http://localhost:10101`

All responses are JSON in the shape:

```json
{ "code": 0, "msg": "success", "data": {} }
```

- `code = 0` success
- `code != 0` error (HTTP status will also reflect errors for most endpoints)

## Camera push endpoints (HX-CCD21 → Server)

### POST `/api/camera/heartBeat`

Camera heartbeat (per vendor protocol).

Body (minimum):

```json
{ "sn": "DEVICE_SN", "timestamp": 1752819461 }
```

Optional fields commonly seen:
- `ipAddress`, `macAddress`, `timeZone` (hours), etc.

Response (strict):

```json
{
  "code": 0,
  "msg": "success",
  "data": { "uploadInterval": 0, "dataMode": "Add", "time": 1752820142, "timezone": 3 }
}
```

### POST `/api/camera/dataUpload`

Flow data upload.

Body (typical):

```json
{
  "sn": "DEVICE_SN",
  "startTime": 1752820800,
  "endTime": 1752820860,
  "time": 1752820860,
  "in": 3,
  "out": 1,
  "passby": 5,
  "turnback": 1,
  "avgStayTime": 60000,
  "dataMode": "Add",
  "attributes": [
    { "personId": 2458, "eventType": 0, "gender": 1, "age": [31, 45], "height": 164, "stayTime": 1640 }
  ]
}
```

Notes:
- `dataMode`:
  - `"Add"` = incremental counts
  - `"Total"` = cumulative counts (server converts to deltas automatically)

Response (strict):

```json
{ "code": 0, "msg": "Reported successfully", "data": { "sn": "DEVICE_SN", "time": 1752820860 } }
```

### POST `/api/camera/reid` (optional, vendor v2.4)

Stores REID report payloads from the camera. Also available at `/reid`.

Response:

```json
{ "code": 0, "msg": "Reported successfully" }
```

### POST `/api/camera/dup` (optional, vendor v2.4)

Stores deduplication report payloads from the camera. Also available at `/dup`.

Response:

```json
{ "code": 0, "msg": "Reported successfully" }
```

## Dashboard / Odoo read APIs (Server → Clients)

These are safe for Odoo to call.

### GET `/api/overview?shopId=<id>`

Shop overview for “today” (using the shop timezone offset).

Fields:
- `visitors`, `passby`, `turnback`
- `avgDwellMs`, `peakOccupancy`, `returnVisitors`
- `occupancy`: “current occupancy today” = SUM(in) - SUM(out) since start-of-day
- `occupancySince`: unix timestamp for the start-of-day boundary

### GET `/api/analytics?range=today|week|month&shopId=<id>`

Returns:
- `traffic.points[]` (trend buckets)
- `demographics.gender[]`, `demographics.age[]`

### GET `/api/traffic/live?minutes=60&shopId=<id>`

Minute-bucket live traffic for charts (in/out).

### GET `/api/metrics?range=today|week|month&shopId=<id>`

Single call intended for integrations (e.g. Odoo). Returns:

- `overview`:
  - `visitors` (today)
  - `occupancy` (current occupancy **since start-of-day**)
  - `passby`, `turnback`, `avgDwellMs`, `peakOccupancy`, `returnVisitors`
  - `timezoneOffsetMinutes`, `occupancySince`
- `traffic` (trend series for the requested `range`)
- `liveTraffic` (last 60 minutes in/out buckets)
- `demographics` (gender + age distributions for the requested `range`)

### GET `/api/devices`

Device list + last seen + online/offline.

### GET `/api/shops`

Shop list + timezone offset + thresholds.

## Not in scope for Odoo

This server also has admin endpoints used by the dashboard UI (device management, labeling, shop settings). Those are intentionally **not documented here** for the Odoo integration.
