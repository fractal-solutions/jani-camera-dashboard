import type { Database } from "bun:sqlite";

function startOfDayUnixWithOffset(nowUnix: number, offsetMinutes: number): number {
  const offsetSec = Math.trunc(offsetMinutes) * 60;
  const shifted = nowUnix + offsetSec;
  const startShifted = Math.floor(shifted / 86400) * 86400;
  return startShifted - offsetSec;
}

export function getDeviceOccupancy(db: Database, sn: string): number {
  const row = db
    .query<{ occ: number }, [string]>("SELECT COALESCE(SUM(in_count) - SUM(out_count), 0) AS occ FROM flow_events WHERE sn = ?")
    .get(sn);
  return Math.max(0, row?.occ ?? 0);
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
  return Math.max(0, row?.occ ?? 0);
}

export function getOverviewToday(db: Database, shopId: number | undefined, timezoneOffsetMinutes: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = startOfDayUnixWithOffset(now, timezoneOffsetMinutes);

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
      `WITH ordered AS (
        SELECT
          fe.timestamp AS ts,
          SUM(fe.in_count - fe.out_count) OVER (ORDER BY fe.timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS occ
        FROM flow_events fe
        ${whereShop}
      )
      SELECT COALESCE(MAX(occ), 0) AS peak FROM ordered`,
    )
    .get(...params);

  const returns = db
    .query<{ return_visitors: number }, any[]>(
      shopId
        ? `SELECT COUNT(DISTINCT pa.person_id) AS return_visitors
           FROM people_attributes pa
           JOIN devices d ON d.sn = pa.sn
           WHERE d.shop_id = ? AND pa.timestamp >= ? AND pa.event_type = 3 AND pa.person_id IS NOT NULL`
        : `SELECT COUNT(DISTINCT pa.person_id) AS return_visitors
           FROM people_attributes pa
           WHERE pa.timestamp >= ? AND pa.event_type = 3 AND pa.person_id IS NOT NULL`,
    )
    .get(...params);

  return {
    now,
    start,
    visitors: totals?.visitors ?? 0,
    passby: totals?.passby ?? 0,
    turnback: totals?.turnback ?? 0,
    avgDwellMs: totals?.avg_dwell_ms ?? null,
    peakOccupancy: Math.max(0, peak?.peak ?? 0),
    returnVisitors: returns?.return_visitors ?? 0,
  };
}

export function getTrafficSeries(db: Database, range: "today" | "week" | "month", shopId: number | undefined, timezoneOffsetMinutes: number) {
  const now = Math.floor(Date.now() / 1000);
  const seconds = range === "today" ? 24 * 3600 : range === "week" ? 7 * 24 * 3600 : 30 * 24 * 3600;
  const start = now - seconds;
  const offsetSec = Math.trunc(timezoneOffsetMinutes) * 60;

  const group = range === "today" ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d 00:00:00";
  const whereShop = shopId ? "JOIN devices d ON d.sn = fe.sn WHERE d.shop_id = ? AND fe.timestamp >= ?" : "WHERE fe.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const rows = db
    .query<{ bucket: string; in_sum: number; out_sum: number; pass_sum: number }, any[]>(
      `SELECT
        strftime('${group}', fe.timestamp + ${offsetSec}, 'unixepoch') AS bucket,
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

export function getLiveTraffic(db: Database, minutes: number, shopId: number | undefined, timezoneOffsetMinutes: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - minutes * 60;
  const offsetSec = Math.trunc(timezoneOffsetMinutes) * 60;
  const whereShop = shopId ? "JOIN devices d ON d.sn = fe.sn WHERE d.shop_id = ? AND fe.timestamp >= ?" : "WHERE fe.timestamp >= ?";
  const params = shopId ? [shopId, start] : [start];

  const rows = db
    .query<{ bucket: string; in_sum: number; out_sum: number }, any[]>(
      `SELECT
        strftime('%Y-%m-%d %H:%M:00', fe.timestamp + ${offsetSec}, 'unixepoch') AS bucket,
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

export function getDemographics(db: Database, range: "today" | "week" | "month", shopId: number | undefined, _timezoneOffsetMinutes: number) {
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
