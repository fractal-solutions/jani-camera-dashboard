import { getDb, migrateDb } from "./index";
import { CONFIG } from "../config";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

migrateDb();
const db = getDb();

const seedShopName = process.env.SEED_SHOP_NAME ?? "Main Shop";
const seedDeviceSn = process.env.SEED_DEVICE_SN ?? "HX-CCD21-DEMO-0001";
const seedDeviceName = process.env.SEED_DEVICE_NAME ?? "Entrance Camera";

const tx = db.transaction(() => {
  db.query(
    `INSERT INTO shops (name, timezone, timezone_offset_minutes, occupancy_limit, inactivity_minutes_limit, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       timezone=excluded.timezone,
       timezone_offset_minutes=excluded.timezone_offset_minutes,
       occupancy_limit=excluded.occupancy_limit,
       inactivity_minutes_limit=excluded.inactivity_minutes_limit`,
  ).run(
    seedShopName,
    CONFIG.timezone,
    CONFIG.timezoneOffsetMinutes,
    CONFIG.occupancyDefaultLimit,
    CONFIG.inactivityDefaultMinutes,
    nowUnix(),
  );

  const shop = db.query<{ id: number }, [string]>("SELECT id FROM shops WHERE name = ?").get(seedShopName);
  const shopId = shop?.id ?? null;

  db.query(
    "INSERT INTO devices (sn, name, shop_id, status, data_mode, created_at) VALUES (?, ?, ?, 'offline', ?, ?) ON CONFLICT(sn) DO NOTHING",
  ).run(seedDeviceSn, seedDeviceName, shopId, CONFIG.defaultDataMode, nowUnix());
});

tx();
console.log(`✅ Seeded shop="${seedShopName}" device sn="${seedDeviceSn}"`);
