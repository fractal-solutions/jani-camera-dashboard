import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./db/migrations";
import { getDemographics, getOverviewToday, getTrafficSeries } from "./analytics";

function unix(iso: string): number {
  return Math.trunc(new Date(iso).getTime() / 1000);
}

function makeDb(): Database {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration.up);
  db.query(
    `INSERT INTO shops (id, name, timezone, timezone_offset_minutes, occupancy_limit, inactivity_minutes_limit, created_at)
     VALUES (1, 'Main Shop', 'Africa/Nairobi', 180, 50, 10, 0)`,
  ).run();
  db.query(
    `INSERT INTO devices (sn, name, shop_id, status, data_mode, created_at)
     VALUES ('SN-1', 'Entrance', 1, 'online', 'Add', 0)`,
  ).run();
  return db;
}

describe("analytics", () => {
  let originalNow: () => number;

  beforeEach(() => {
    originalNow = Date.now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  test("overview falls back to people stay_time_ms when flow avgStayTime is missing", () => {
    Date.now = () => new Date("2026-05-07T09:00:00Z").getTime();
    const db = makeDb();

    db.query(
      `INSERT INTO flow_events
        (event_uid, sn, timestamp, in_count, out_count, passby, turnback, avg_stay_time_ms, data_mode, raw_in, raw_out, raw_passby, raw_turnback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("evt-1", "SN-1", unix("2026-05-07T07:00:00Z"), 3, 1, 5, 1, null, "Add", 3, 1, 5, 1, 0);

    db.query(
      `INSERT INTO people_attributes
        (sn, source_event_uid, person_id, timestamp, gender, age_min, age_max, stay_time_ms, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("SN-1", "evt-1", "p-1", unix("2026-05-07T07:00:00Z"), 1, 25, 35, 120000, 0, 0);

    const overview = getOverviewToday(db, 1, 180);
    expect(overview.avgDwellMs).toBe(120000);
  });

  test("today traffic uses the shop start-of-day boundary instead of a rolling 24h window", () => {
    Date.now = () => new Date("2026-05-07T09:00:00Z").getTime();
    const db = makeDb();

    db.query(
      `INSERT INTO flow_events
        (event_uid, sn, timestamp, in_count, out_count, passby, turnback, avg_stay_time_ms, data_mode, raw_in, raw_out, raw_passby, raw_turnback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("evt-in", "SN-1", unix("2026-05-06T22:00:00Z"), 2, 0, 0, 0, 60000, "Add", 2, 0, 0, 0, 0);

    db.query(
      `INSERT INTO flow_events
        (event_uid, sn, timestamp, in_count, out_count, passby, turnback, avg_stay_time_ms, data_mode, raw_in, raw_out, raw_passby, raw_turnback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("evt-out", "SN-1", unix("2026-05-06T20:30:00Z"), 9, 0, 0, 0, 60000, "Add", 9, 0, 0, 0, 0);

    const traffic = getTrafficSeries(db, "today", 1, 180);
    expect(traffic.points).toHaveLength(1);
    expect(traffic.points[0]?.in_sum).toBe(2);
  });

  test("demographics exclude unknown ages and bucket known ages consistently", () => {
    Date.now = () => new Date("2026-05-07T09:00:00Z").getTime();
    const db = makeDb();

    db.query(
      `INSERT INTO people_attributes
        (sn, source_event_uid, person_id, timestamp, gender, age_min, age_max, stay_time_ms, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("SN-1", "evt-a", "p-a", unix("2026-05-07T07:00:00Z"), 1, 31, 45, 5000, 0, 0);

    db.query(
      `INSERT INTO people_attributes
        (sn, source_event_uid, person_id, timestamp, gender, age_min, age_max, stay_time_ms, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("SN-1", "evt-b", "p-b", unix("2026-05-07T07:05:00Z"), 2, null, null, 5000, 0, 0);

    db.query(
      `INSERT INTO people_attributes
        (sn, source_event_uid, person_id, timestamp, gender, age_min, age_max, stay_time_ms, event_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("SN-1", "evt-c", "p-c", unix("2026-05-07T07:10:00Z"), 2, 19, null, 5000, 0, 0);

    const demographics = getDemographics(db, "today", 1, 180);
    expect(demographics.age).toEqual([
      { bucket: "18-25", cnt: 1 },
      { bucket: "36-45", cnt: 1 },
    ]);
  });
});
