export const CONFIG = {
  dbPath: process.env.DB_PATH ?? "./data/app.sqlite",
  timezone: process.env.TZ ?? "Africa/Nairobi",
  timezoneOffsetMinutes: Number(process.env.TZ_OFFSET_MINUTES ?? "180"),
  adminToken: process.env.ADMIN_TOKEN ?? "",
  defaultDataMode: (process.env.DEFAULT_DATA_MODE ?? "Add") as "Add" | "Total",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? "120"),
  inactivityDefaultMinutes: Number(process.env.INACTIVITY_DEFAULT_MINUTES ?? "10"),
  occupancyDefaultLimit: Number(process.env.OCCUPANCY_DEFAULT_LIMIT ?? "50"),
};

export type DataMode = "Add" | "Total";
