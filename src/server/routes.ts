import type { Server } from "bun";
import { CONFIG, type DataMode } from "./config";
import { getDb, migrateDb } from "./db";
import { json } from "./http/json";
import { readJson } from "./http/body";
import { RateLimiter } from "./http/rateLimit";
import { getDeviceOccupancy, getDemographics, getLiveTraffic, getOverviewToday, getShopOccupancy, getTrafficSeries } from "./analytics";
import { parseDataUpload, parseHeartbeat } from "./validation";
import { WsHub } from "./ws";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function requireAdmin(req: Request): Response | null {
  if (!CONFIG.adminToken) return json({ code: 500, msg: "ADMIN_TOKEN not configured" }, { status: 500 });
  const token = req.headers.get("x-admin-token");
  if (!token || token !== CONFIG.adminToken) return json({ code: 401, msg: "unauthorized" }, { status: 401 });
  return null;
}

function snNotFound(): Response {
  return json({ code: 401, msg: "unknown sn" }, { status: 401 });
}

function badRequest(msg: string): Response {
  return json({ code: 400, msg }, { status: 400 });
}

function safeDelta(current: number, last: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(last)) return 0;
  const d = current - last;
  return d < 0 ? 0 : d;
}

function buildEventUid(payload: {
  sn: string;
  time: number;
  startTime?: number;
  endTime?: number;
  in: number;
  out: number;
  passby: number;
  turnback: number;
  avgStayTime?: number;
}, mode: DataMode): string {
  return [
    payload.sn,
    payload.time,
    payload.startTime ?? "",
    payload.endTime ?? "",
    mode,
    payload.in,
    payload.out,
    payload.passby,
    payload.turnback,
    payload.avgStayTime ?? "",
  ].join("|");
}

export function createApi(server: Server, hub: WsHub) {
  migrateDb();
  const db = getDb();
  const limiter = new RateLimiter(CONFIG.rateLimitPerMinute);

  return {
    async handle(req: Request): Promise<Response | undefined> {
      const url = new URL(req.url);
      const path = url.pathname;

      // Health
      if (path === "/api/health" && req.method === "GET") {
        return json({ ok: true, time: nowUnix() });
      }

      // Admin: register device/shop
      if (path === "/api/admin/registerDevice" && req.method === "POST") {
        const auth = requireAdmin(req);
        if (auth) return auth;
        const body = await readJson(req);
        if (typeof body !== "object" || body === null) return badRequest("body must be object");
        const b = body as Record<string, unknown>;
        const sn = typeof b.sn === "string" ? b.sn.trim() : "";
        const name = typeof b.name === "string" ? b.name.trim() : "Camera";
        const shopName = typeof b.shopName === "string" ? b.shopName.trim() : "Main Shop";
        const dataMode = b.dataMode === "Add" || b.dataMode === "Total" ? (b.dataMode as DataMode) : CONFIG.defaultDataMode;
        const timezoneOffsetMinutes = typeof b.timezoneOffsetMinutes === "number" ? Math.trunc(b.timezoneOffsetMinutes) : CONFIG.timezoneOffsetMinutes;
        if (!sn) return badRequest("sn required");
        const tx = db.transaction(() => {
          db.query(
            "INSERT INTO shops (name, timezone, timezone_offset_minutes, occupancy_limit, inactivity_minutes_limit, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET timezone_offset_minutes=excluded.timezone_offset_minutes",
          ).run(shopName, CONFIG.timezone, timezoneOffsetMinutes, CONFIG.occupancyDefaultLimit, CONFIG.inactivityDefaultMinutes, nowUnix());
          const shop = db.query<{ id: number }, [string]>("SELECT id FROM shops WHERE name = ?").get(shopName);
          db.query(
            "INSERT INTO devices (sn, name, shop_id, status, data_mode, created_at) VALUES (?, ?, ?, 'offline', ?, ?) ON CONFLICT(sn) DO UPDATE SET name=excluded.name, shop_id=excluded.shop_id, data_mode=excluded.data_mode",
          ).run(sn, name, shop?.id ?? null, dataMode, nowUnix());
        });
        tx();
        return json({ code: 0, msg: "success", data: { sn, name, shopName, dataMode } });
      }

      if (path === "/api/admin/labelPerson" && req.method === "POST") {
        const auth = requireAdmin(req);
        if (auth) return auth;
        const body = await readJson(req);
        if (typeof body !== "object" || body === null) return badRequest("body must be object");
        const b = body as Record<string, unknown>;
        const sn = typeof b.sn === "string" ? b.sn.trim() : "";
        const personId =
          typeof b.personId === "string" ? b.personId.trim()
          : typeof b.personId === "number" ? String(Math.trunc(b.personId))
          : "";
        const label = typeof b.label === "string" ? b.label.trim() : "";
        if (!sn) return badRequest("sn required");
        if (!personId) return badRequest("personId required");
        if (!label) return badRequest("label required");

        const device = db.query<{ sn: string }, [string]>("SELECT sn FROM devices WHERE sn = ?").get(sn);
        if (!device) return snNotFound();

        db.query(
          `INSERT INTO person_labels (sn, person_id, label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(sn, person_id) DO UPDATE SET
             label=excluded.label,
             updated_at=excluded.updated_at`,
        ).run(sn, personId, label, nowUnix(), nowUnix());

        return json({ code: 0, msg: "success", data: { sn, personId, label } });
      }

      if (path === "/api/labels" && req.method === "GET") {
        const sn = (url.searchParams.get("sn") ?? "").trim();
        if (!sn) return badRequest("sn required");
        const rows = db
          .query<{ person_id: string; label: string }, [string]>(
            `SELECT person_id, label FROM person_labels WHERE sn = ? ORDER BY updated_at DESC`,
          )
          .all(sn);
        return json({ code: 0, msg: "success", data: rows });
      }

      if (path === "/api/people" && req.method === "GET") {
        const sn = (url.searchParams.get("sn") ?? "").trim();
        if (!sn) return badRequest("sn required");
        const limitParam = Number(url.searchParams.get("limit") ?? "100");
        const limit = Number.isFinite(limitParam) ? Math.max(10, Math.min(500, Math.trunc(limitParam))) : 100;

        const device = db.query<{ sn: string }, [string]>("SELECT sn FROM devices WHERE sn = ?").get(sn);
        if (!device) return snNotFound();

        const rows = db
          .query<
            {
              person_id: string;
              last_seen: number;
              events: number;
              enters: number;
              leaves: number;
              returns: number;
              pass: number;
              gender: number | null;
              age_min: number | null;
              age_max: number | null;
              label: string | null;
            },
            [string, number]
          >(
            `SELECT
              pa.person_id AS person_id,
              MAX(pa.timestamp) AS last_seen,
              COUNT(*) AS events,
              SUM(CASE WHEN pa.event_type = 0 THEN 1 ELSE 0 END) AS enters,
              SUM(CASE WHEN pa.event_type = 1 THEN 1 ELSE 0 END) AS leaves,
              SUM(CASE WHEN pa.event_type = 3 THEN 1 ELSE 0 END) AS returns,
              SUM(CASE WHEN pa.event_type = 2 THEN 1 ELSE 0 END) AS pass,
              MAX(pa.gender) AS gender,
              MAX(pa.age_min) AS age_min,
              MAX(pa.age_max) AS age_max,
              pl.label AS label
            FROM people_attributes pa
            LEFT JOIN person_labels pl ON pl.sn = pa.sn AND pl.person_id = pa.person_id
            WHERE pa.sn = ? AND pa.person_id IS NOT NULL
            GROUP BY pa.person_id
            ORDER BY last_seen DESC
            LIMIT ?`,
          )
          .all(sn, limit);

        return json({ code: 0, msg: "success", data: rows });
      }

      // Admin: devices list
      if (path === "/api/devices" && req.method === "GET") {
        const rows = db
          .query(
            `SELECT d.sn, d.name, d.last_seen, d.status, d.data_mode, d.ip_address, d.mac_address, s.name AS shop_name, s.id AS shop_id
             FROM devices d
             LEFT JOIN shops s ON s.id = d.shop_id
             ORDER BY d.name ASC`,
          )
          .all();
        return json({ code: 0, msg: "success", data: rows });
      }

      if (path === "/api/shops" && req.method === "GET") {
        const shops = db
          .query(
            `SELECT id, name, timezone, timezone_offset_minutes, occupancy_limit, inactivity_minutes_limit
             FROM shops
             ORDER BY name ASC`,
          )
          .all();
        return json({ code: 0, msg: "success", data: shops });
      }

      if (path === "/api/admin/updateShop" && req.method === "POST") {
        const auth = requireAdmin(req);
        if (auth) return auth;
        const body = await readJson(req);
        if (typeof body !== "object" || body === null) return badRequest("body must be object");
        const b = body as Record<string, unknown>;
        const id = typeof b.id === "number" ? Math.trunc(b.id) : NaN;
        if (!Number.isFinite(id)) return badRequest("id required");
        const tzOffsetMinutes = typeof b.timezoneOffsetMinutes === "number" ? Math.trunc(b.timezoneOffsetMinutes) : undefined;
        const occupancyLimit = typeof b.occupancyLimit === "number" ? Math.trunc(b.occupancyLimit) : undefined;
        const inactivityMinutes = typeof b.inactivityMinutes === "number" ? Math.trunc(b.inactivityMinutes) : undefined;

        db.query(
          `UPDATE shops SET
             timezone_offset_minutes = COALESCE(?, timezone_offset_minutes),
             occupancy_limit = COALESCE(?, occupancy_limit),
             inactivity_minutes_limit = COALESCE(?, inactivity_minutes_limit)
           WHERE id = ?`,
        ).run(
          tzOffsetMinutes ?? null,
          occupancyLimit ?? null,
          inactivityMinutes ?? null,
          id,
        );

        return json({ code: 0, msg: "success", data: { id, timezoneOffsetMinutes: tzOffsetMinutes, occupancyLimit, inactivityMinutes } });
      }

      // Admin: overview & analytics
      if (path === "/api/overview" && req.method === "GET") {
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const shopNum = Number.isFinite(shop as number) ? (shop as number) : undefined;
        const tz = shopNum
          ? db.query<{ timezone_offset_minutes: number }, [number]>("SELECT timezone_offset_minutes FROM shops WHERE id = ?").get(shopNum)
          : null;
        const tzOffsetMinutes = tz?.timezone_offset_minutes ?? CONFIG.timezoneOffsetMinutes;
        const overview = getOverviewToday(db, shopNum, tzOffsetMinutes);
        const occupancy = shopNum ? getShopOccupancy(db, shopNum) : null;
        return json({ code: 0, msg: "success", data: { ...overview, occupancy, timezoneOffsetMinutes: tzOffsetMinutes } });
      }

      if (path === "/api/analytics" && req.method === "GET") {
        const range = (url.searchParams.get("range") ?? "today") as "today" | "week" | "month";
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const shopNum = Number.isFinite(shop as number) ? (shop as number) : undefined;
        const tz = shopNum
          ? db.query<{ timezone_offset_minutes: number }, [number]>("SELECT timezone_offset_minutes FROM shops WHERE id = ?").get(shopNum)
          : null;
        const tzOffsetMinutes = tz?.timezone_offset_minutes ?? CONFIG.timezoneOffsetMinutes;
        const traffic = getTrafficSeries(db, range, shopNum, tzOffsetMinutes);
        const demo = getDemographics(db, range, shopNum, tzOffsetMinutes);
        return json({ code: 0, msg: "success", data: { traffic, demographics: demo } });
      }

      if (path === "/api/traffic/live" && req.method === "GET") {
        const minutes = Number(url.searchParams.get("minutes") ?? "60");
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const shopNum = Number.isFinite(shop as number) ? (shop as number) : undefined;
        const tz = shopNum
          ? db.query<{ timezone_offset_minutes: number }, [number]>("SELECT timezone_offset_minutes FROM shops WHERE id = ?").get(shopNum)
          : null;
        const tzOffsetMinutes = tz?.timezone_offset_minutes ?? CONFIG.timezoneOffsetMinutes;
        const live = getLiveTraffic(
          db,
          Number.isFinite(minutes) ? Math.max(5, Math.min(360, Math.trunc(minutes))) : 60,
          shopNum,
          tzOffsetMinutes,
        );
        return json({ code: 0, msg: "success", data: live });
      }

      // Camera: heartbeat (STRICT RESPONSE)
      if (path === "/api/camera/heartBeat" && req.method === "POST") {
        const ip = server.requestIP(req)?.address ?? "unknown";
        if (!limiter.allow(`hb:${ip}`)) return json({ code: 429, msg: "rate limited" }, { status: 429 });

        let payload;
        try {
          payload = parseHeartbeat(await readJson(req));
        } catch (e) {
          return badRequest(e instanceof Error ? e.message : "invalid payload");
        }

        const device = db.query<{ sn: string; data_mode: string }, [string]>("SELECT sn, data_mode FROM devices WHERE sn = ?").get(payload.sn);
        if (!device) return snNotFound();

        db.query(
          "UPDATE devices SET last_seen = ?, status = 'online', ip_address = COALESCE(?, ip_address), mac_address = COALESCE(?, mac_address), timezone_offset_hours = COALESCE(?, timezone_offset_hours) WHERE sn = ?",
        ).run(nowUnix(), payload.ipAddress ?? null, payload.macAddress ?? null, payload.timeZone ?? null, payload.sn);

        const shopRow = db
          .query<{ timezone_offset_minutes: number | null }, [string]>(
            `SELECT s.timezone_offset_minutes AS timezone_offset_minutes
             FROM devices d
             JOIN shops s ON s.id = d.shop_id
             WHERE d.sn = ?`,
          )
          .get(payload.sn);
        const tzOffsetMinutes = shopRow?.timezone_offset_minutes ?? CONFIG.timezoneOffsetMinutes;

        return json({
          code: 0,
          msg: "success",
          data: {
            uploadInterval: 0,
            dataMode: (device.data_mode === "Total" ? "Total" : "Add") as DataMode,
            time: nowUnix(),
            timezone: Math.trunc(tzOffsetMinutes / 60),
          },
        });
      }

      // Camera: dataUpload (STRICT RESPONSE)
      if (path === "/api/camera/dataUpload" && req.method === "POST") {
        const ip = server.requestIP(req)?.address ?? "unknown";
        if (!limiter.allow(`du:${ip}`)) return json({ code: 429, msg: "rate limited" }, { status: 429 });

        let payload;
        try {
          payload = parseDataUpload(await readJson(req));
        } catch (e) {
          return badRequest(e instanceof Error ? e.message : "invalid payload");
        }

        const device = db
          .query<{ sn: string; shop_id: number | null; data_mode: DataMode }, [string]>("SELECT sn, shop_id, data_mode FROM devices WHERE sn = ?")
          .get(payload.sn);
        if (!device) return snNotFound();

        const mode: DataMode = payload.dataMode ?? (device.data_mode === "Total" ? "Total" : "Add");

        const inserted = db.transaction(() => {
          db.query("UPDATE devices SET last_seen = ?, status = 'online' WHERE sn = ?").run(nowUnix(), payload.sn);

          let inDelta = payload.in;
          let outDelta = payload.out;
          let passDelta = payload.passby;
          let turnDelta = payload.turnback;
          const eventUid = buildEventUid(payload, mode);

          if (mode === "Total") {
            const counters = db
              .query<
                { last_in_total: number; last_out_total: number; last_passby_total: number; last_turnback_total: number },
                [string]
              >("SELECT last_in_total, last_out_total, last_passby_total, last_turnback_total FROM device_counters WHERE sn = ?")
              .get(payload.sn);

            inDelta = safeDelta(payload.in, counters?.last_in_total ?? 0);
            outDelta = safeDelta(payload.out, counters?.last_out_total ?? 0);
            passDelta = safeDelta(payload.passby, counters?.last_passby_total ?? 0);
            turnDelta = safeDelta(payload.turnback, counters?.last_turnback_total ?? 0);

            db.query(
              `INSERT INTO device_counters (sn, last_time, last_in_total, last_out_total, last_passby_total, last_turnback_total, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(sn) DO UPDATE SET
                 last_time=excluded.last_time,
                 last_in_total=excluded.last_in_total,
                 last_out_total=excluded.last_out_total,
                 last_passby_total=excluded.last_passby_total,
                 last_turnback_total=excluded.last_turnback_total,
                 updated_at=excluded.updated_at`,
            ).run(payload.sn, payload.time, payload.in, payload.out, payload.passby, payload.turnback, nowUnix());
          }

          const flowInsert = db.query(
            `INSERT INTO flow_events
              (event_uid, sn, timestamp, start_time, end_time, in_count, out_count, passby, turnback, avg_stay_time_ms, data_mode, raw_in, raw_out, raw_passby, raw_turnback, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(event_uid) DO NOTHING`,
          ).run(
            eventUid,
            payload.sn,
            payload.time,
            payload.startTime ?? null,
            payload.endTime ?? null,
            inDelta,
            outDelta,
            passDelta,
            turnDelta,
            payload.avgStayTime ?? null,
            mode,
            payload.in,
            payload.out,
            payload.passby,
            payload.turnback,
            nowUnix(),
          );

          if ((flowInsert as { changes?: number }).changes === 0) {
            return { duplicate: true, eventUid, inDelta: 0, outDelta: 0, passDelta: 0, turnDelta: 0 };
          }

          if (payload.attributes?.length) {
            const stmt = db.query(
              `INSERT INTO people_attributes
                (sn, source_event_uid, person_id, timestamp, gender, age_min, age_max, height, stay_time_ms, event_type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT DO NOTHING`,
            );
            for (const attr of payload.attributes) {
              stmt.run(
                payload.sn,
                eventUid,
                attr.personId ?? null,
                payload.time,
                attr.gender ?? null,
                attr.age?.[0] ?? null,
                attr.age?.[1] ?? null,
                attr.height ?? null,
                attr.stayTime ?? null,
                attr.eventType ?? null,
                nowUnix(),
              );
            }
          }
          return { duplicate: false, eventUid, inDelta, outDelta, passDelta, turnDelta };
        })();

        const deviceOcc = getDeviceOccupancy(db, payload.sn);
        const shopOcc = device.shop_id ? getShopOccupancy(db, device.shop_id) : null;

        if (!inserted.duplicate) {
          hub.broadcast("flow:update", {
            sn: payload.sn,
            time: payload.time,
            mode,
            counts: { in: inserted.inDelta, out: inserted.outDelta, passby: inserted.passDelta, turnback: inserted.turnDelta },
            occupancy: { device: deviceOcc, shop: shopOcc },
          });
          hub.broadcast("occupancy:update", { sn: payload.sn, occupancy: deviceOcc, shopId: device.shop_id, shopOccupancy: shopOcc });
        }

        return json({
          code: 0,
          msg: "Reported successfully",
          data: { sn: payload.sn, time: payload.time },
        });
      }

      // Camera: daily duplicate report (/dup) and reid report (/reid) per vendor doc
      if ((path === "/api/camera/dup" || path === "/dup") && req.method === "POST") {
        const ip = server.requestIP(req)?.address ?? "unknown";
        if (!limiter.allow(`dup:${ip}`)) return json({ code: 429, msg: "rate limited" }, { status: 429 });

        const body = await readJson(req);
        if (typeof body !== "object" || body === null) return badRequest("body must be object");

        const b = body as Record<string, unknown>;
        let sn: string | null = typeof b.sn === "string" ? b.sn : null;
        const records = Array.isArray(b.records) ? (b.records as any[]) : [];
        if (!sn && records.length) {
          const firstEnter = records?.[0]?.enters?.[0];
          if (firstEnter && typeof firstEnter.cameraSN === "string") sn = firstEnter.cameraSN;
        }
        if (!sn) return badRequest("sn/cameraSN missing");
        const device = db.query<{ sn: string }, [string]>("SELECT sn FROM devices WHERE sn = ?").get(sn);
        if (!device) return snNotFound();

        const reportTime =
          typeof b.time === "number" ? Math.trunc(b.time) :
          typeof b.timestamp === "number" ? Math.trunc(b.timestamp) :
          nowUnix();

        db.query(
          "INSERT INTO camera_reports (sn, report_type, report_time, payload_json, created_at) VALUES (?, 'dup', ?, ?, ?)",
        ).run(sn, reportTime, JSON.stringify(body), nowUnix());

        return json({ code: 0, msg: "Reported successfully" });
      }

      if ((path === "/api/camera/reid" || path === "/reid") && req.method === "POST") {
        const ip = server.requestIP(req)?.address ?? "unknown";
        if (!limiter.allow(`reid:${ip}`)) return json({ code: 429, msg: "rate limited" }, { status: 429 });

        const body = await readJson(req);
        if (typeof body !== "object" && !Array.isArray(body)) return badRequest("body must be object/array");

        // Try to extract a camera SN from the first pair if possible.
        let sn: string | null = null;
        if (Array.isArray(body)) {
          const first = body[0] as any;
          const firstPair = first?.pairs?.[0];
          const enter = firstPair?.enter;
          if (enter && typeof enter.cameraSN === "string") sn = enter.cameraSN;
        } else {
          const b = body as any;
          const firstPair = b?.pairs?.[0];
          const enter = firstPair?.enter;
          if (enter && typeof enter.cameraSN === "string") sn = enter.cameraSN;
        }
        if (!sn) return badRequest("cameraSN missing");
        const device = db.query<{ sn: string }, [string]>("SELECT sn FROM devices WHERE sn = ?").get(sn);
        if (!device) return snNotFound();

        db.query(
          "INSERT INTO camera_reports (sn, report_type, report_time, payload_json, created_at) VALUES (?, 'reid', ?, ?, ?)",
        ).run(sn, nowUnix(), JSON.stringify(body), nowUnix());

        return json({ code: 0, msg: "Reported successfully" });
      }

      if (path.startsWith("/api/")) return json({ code: 404, msg: "not found" }, { status: 404 });
      return undefined;
    },
  };
}
