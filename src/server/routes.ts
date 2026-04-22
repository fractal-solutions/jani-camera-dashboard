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
        if (!sn) return badRequest("sn required");
        const tx = db.transaction(() => {
          db.query(
            "INSERT INTO shops (name, timezone, occupancy_limit, inactivity_minutes_limit, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING",
          ).run(shopName, CONFIG.timezone, CONFIG.occupancyDefaultLimit, CONFIG.inactivityDefaultMinutes, nowUnix());
          const shop = db.query<{ id: number }, [string]>("SELECT id FROM shops WHERE name = ?").get(shopName);
          db.query(
            "INSERT INTO devices (sn, name, shop_id, status, data_mode, created_at) VALUES (?, ?, ?, 'offline', ?, ?) ON CONFLICT(sn) DO UPDATE SET name=excluded.name, shop_id=excluded.shop_id, data_mode=excluded.data_mode",
          ).run(sn, name, shop?.id ?? null, dataMode, nowUnix());
        });
        tx();
        return json({ code: 0, msg: "success", data: { sn, name, shopName, dataMode } });
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
            `SELECT id, name, timezone, occupancy_limit, inactivity_minutes_limit
             FROM shops
             ORDER BY name ASC`,
          )
          .all();
        return json({ code: 0, msg: "success", data: shops });
      }

      // Admin: overview & analytics
      if (path === "/api/overview" && req.method === "GET") {
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const overview = getOverviewToday(db, Number.isFinite(shop as number) ? (shop as number) : undefined);
        const occupancy =
          shop && Number.isFinite(shop) ?
            getShopOccupancy(db, shop) :
            null;
        return json({ code: 0, msg: "success", data: { ...overview, occupancy } });
      }

      if (path === "/api/analytics" && req.method === "GET") {
        const range = (url.searchParams.get("range") ?? "today") as "today" | "week" | "month";
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const traffic = getTrafficSeries(db, range, Number.isFinite(shop as number) ? (shop as number) : undefined);
        const demo = getDemographics(db, range, Number.isFinite(shop as number) ? (shop as number) : undefined);
        return json({ code: 0, msg: "success", data: { traffic, demographics: demo } });
      }

      if (path === "/api/traffic/live" && req.method === "GET") {
        const minutes = Number(url.searchParams.get("minutes") ?? "60");
        const shopId = url.searchParams.get("shopId");
        const shop = shopId ? Number(shopId) : undefined;
        const live = getLiveTraffic(db, Number.isFinite(minutes) ? Math.max(5, Math.min(360, Math.trunc(minutes))) : 60, Number.isFinite(shop as number) ? (shop as number) : undefined);
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
          "UPDATE devices SET last_seen = ?, status = 'online', ip_address = COALESCE(?, ip_address), mac_address = COALESCE(?, mac_address) WHERE sn = ?",
        ).run(nowUnix(), payload.ipAddress ?? null, payload.macAddress ?? null, payload.sn);

        return json({
          code: 0,
          msg: "success",
          data: {
            uploadInterval: 0,
            dataMode: (device.data_mode === "Total" ? "Total" : "Add") as DataMode,
            time: nowUnix(),
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

          db.query(
            `INSERT INTO flow_events
              (sn, timestamp, start_time, end_time, in_count, out_count, passby, turnback, avg_stay_time_ms, data_mode, raw_in, raw_out, raw_passby, raw_turnback, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
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

          if (payload.attributes?.length) {
            const stmt = db.query(
              `INSERT INTO people_attributes
                (sn, person_id, timestamp, gender, age_min, age_max, height, stay_time_ms, event_type, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const attr of payload.attributes) {
              stmt.run(
                payload.sn,
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
          return { inDelta, outDelta, passDelta, turnDelta };
        })();

        const deviceOcc = getDeviceOccupancy(db, payload.sn);
        const shopOcc = device.shop_id ? getShopOccupancy(db, device.shop_id) : null;

        hub.broadcast("flow:update", {
          sn: payload.sn,
          time: payload.time,
          mode,
          counts: { in: inserted.inDelta, out: inserted.outDelta, passby: inserted.passDelta, turnback: inserted.turnDelta },
          occupancy: { device: deviceOcc, shop: shopOcc },
        });
        hub.broadcast("occupancy:update", { sn: payload.sn, occupancy: deviceOcc, shopId: device.shop_id, shopOccupancy: shopOcc });

        return json({
          code: 0,
          msg: "Reported successfully",
          data: { sn: payload.sn, time: payload.time },
        });
      }

      if (path.startsWith("/api/")) return json({ code: 404, msg: "not found" }, { status: 404 });
      return undefined;
    },
  };
}
