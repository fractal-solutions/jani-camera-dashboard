export type Migration = { id: string; up: string };

export const MIGRATIONS: Migration[] = [
  {
    id: "001_init",
    up: `
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        timezone TEXT,
        occupancy_limit INTEGER NOT NULL DEFAULT 50,
        inactivity_minutes_limit INTEGER NOT NULL DEFAULT 10,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sn TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        shop_id INTEGER,
        last_seen INTEGER,
        status TEXT NOT NULL DEFAULT 'offline',
        data_mode TEXT NOT NULL DEFAULT 'Add',
        ip_address TEXT,
        mac_address TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_devices_shop_id ON devices(shop_id);
      CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);

      CREATE TABLE IF NOT EXISTS device_counters (
        sn TEXT PRIMARY KEY,
        last_time INTEGER,
        last_in_total INTEGER NOT NULL DEFAULT 0,
        last_out_total INTEGER NOT NULL DEFAULT 0,
        last_passby_total INTEGER NOT NULL DEFAULT 0,
        last_turnback_total INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sn TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        start_time INTEGER,
        end_time INTEGER,
        in_count INTEGER NOT NULL,
        out_count INTEGER NOT NULL,
        passby INTEGER NOT NULL,
        turnback INTEGER NOT NULL,
        avg_stay_time_ms INTEGER,
        data_mode TEXT NOT NULL,
        raw_in INTEGER,
        raw_out INTEGER,
        raw_passby INTEGER,
        raw_turnback INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (sn) REFERENCES devices(sn) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_flow_events_sn_ts ON flow_events(sn, timestamp);
      CREATE INDEX IF NOT EXISTS idx_flow_events_ts ON flow_events(timestamp);

      CREATE TABLE IF NOT EXISTS people_attributes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sn TEXT NOT NULL,
        person_id TEXT,
        timestamp INTEGER NOT NULL,
        gender INTEGER,
        age_min INTEGER,
        age_max INTEGER,
        height REAL,
        stay_time_ms INTEGER,
        event_type INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (sn) REFERENCES devices(sn) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_people_attrs_sn_ts ON people_attributes(sn, timestamp);
    `,
  },
];

