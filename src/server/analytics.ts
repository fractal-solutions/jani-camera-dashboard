import type { Database } from "bun:sqlite";

function startOfDayUnix(nowUnix: number): number {
  const d = new Date(nowUnix * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function getDeviceOccupancy(db: Database, sn: string): number {
  const row = db
    .query<{ occ: number }, [string]>("SELECT COALESCE(SUM(in_count) - SUM(out_count), 0) AS occ FROM flow_events WHERE sn = ?")
    .get(sn);
  return row?.occ ?? 0;
}

export function getShopOccupancy(db: Database, shopId: number): number {
  const row = db
    .query<{ occ: number }, [number]>(
      `SELECT COALESCE(SUM(fe.in_count) - SUM(fe.out_count), 0) AS occ
       FROM flow_events fe
       JOIN devices d ON d.sn = fe.sn
       WHERE d.shop_id = ?`,
    )
    .get(shopId);
  return row?.occ ?? 0;
}

export function getOverviewToday(db: Database, shopId?: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = startOfDayUnix(now);

  const whereShop = shopId ? "JOIN devices d ON d.sn = fe.sn WHERE d.shop_id = ? AND fe.timestamp >= ?" : "WHERE fe.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const totals = db
    .query<{ visitors: number; passby: number; turnback: number; avg_dwell_ms: number | null }, any[]>(
      `SELECT
        COALESCE(SUM(in_count),0) AS visitors,
        COALESCE(SUM(passby),0) AS passby,
        COALESCE(SUM(turnback),0) AS turnback,
        AVG(avg_stay_time_ms) AS avg_dwell_ms
      FROM flow_events fe
      ${whereShop}`,
    )
    .get(...params);

  const peak = db
    .query<{ peak: number }, any[]>(
      `WITH per_minute AS (
        SELECT strftime('%Y-%m-%d %H:%M:00', timestamp, 'unixepoch') AS bucket, SUM(in_count - out_count) AS net
        FROM flow_events fe
        ${whereShop}
        GROUP BY bucket
      )
      SELECT COALESCE(MAX(net), 0) AS peak FROM per_minute`,
    )
    .get(...params);

  return {
    now,
    start,
    visitors: totals?.visitors ?? 0,
    passby: totals?.passby ?? 0,
    turnback: totals?.turnback ?? 0,
    avgDwellMs: totals?.avg_dwell_ms ?? null,
    peakNetPerMinute: peak?.peak ?? 0,
  };
}

export function getTrafficSeries(db: Database, range: "today" | "week" | "month", shopId?: number) {
  const now = Math.floor(Date.now() / 1000);
  const seconds = range === "today" ? 24 * 3600 : range === "week" ? 7 * 24 * 3600 : 30 * 24 * 3600;
  const start = now - seconds;

  const group = range === "today" ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d 00:00:00";
  const whereShop = shopId ? "JOIN devices d ON d.sn = fe.sn WHERE d.shop_id = ? AND fe.timestamp >= ?" : "WHERE fe.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const rows = db
    .query<{ bucket: string; in_sum: number; out_sum: number; pass_sum: number }, any[]>(
      `SELECT
        strftime('${group}', fe.timestamp, 'unixepoch') AS bucket,
        COALESCE(SUM(fe.in_count),0) AS in_sum,
        COALESCE(SUM(fe.out_count),0) AS out_sum,
        COALESCE(SUM(fe.passby),0) AS pass_sum
      FROM flow_events fe
      ${whereShop}
      GROUP BY bucket
      ORDER BY bucket ASC`,
    )
    .all(...params);

  return { now, start, range, points: rows };
}

export function getLiveTraffic(db: Database, minutes: number, shopId?: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - minutes * 60;
  const whereShop = shopId ? "JOIN devices d ON d.sn = fe.sn WHERE d.shop_id = ? AND fe.timestamp >= ?" : "WHERE fe.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const rows = db
    .query<{ bucket: string; in_sum: number; out_sum: number }, any[]>(
      `SELECT
        strftime('%Y-%m-%d %H:%M:00', fe.timestamp, 'unixepoch') AS bucket,
        COALESCE(SUM(fe.in_count),0) AS in_sum,
        COALESCE(SUM(fe.out_count),0) AS out_sum
      FROM flow_events fe
      ${whereShop}
      GROUP BY bucket
      ORDER BY bucket ASC`,
    )
    .all(...params);

  return { now, start, minutes, points: rows };
}

export function getDemographics(db: Database, range: "today" | "week" | "month", shopId?: number) {
  const now = Math.floor(Date.now() / 1000);
  const seconds = range === "today" ? 24 * 3600 : range === "week" ? 7 * 24 * 3600 : 30 * 24 * 3600;
  const start = now - seconds;
  const whereShop = shopId ? "JOIN devices d ON d.sn = pa.sn WHERE d.shop_id = ? AND pa.timestamp >= ?" : "WHERE pa.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const gender = db
    .query<{ gender: number | null; cnt: number }, any[]>(
      `SELECT gender, COUNT(*) AS cnt FROM people_attributes pa ${whereShop} GROUP BY gender`,
    )
    .all(...params);

  const age = db
    .query<{ bucket: string; cnt: number }, any[]>(
      `SELECT
        CASE
          WHEN age_max < 18 THEN '0-17'
          WHEN age_max < 26 THEN '18-25'
          WHEN age_max < 36 THEN '26-35'
          WHEN age_max < 46 THEN '36-45'
          WHEN age_max < 61 THEN '46-60'
          ELSE '61+'
        END AS bucket,
        COUNT(*) AS cnt
      FROM people_attributes pa
      ${whereShop}
      GROUP BY bucket
      ORDER BY bucket`,
    )
    .all(...params);

  return { now, start, range, gender, age };
}
