import { Database } from "bun:sqlite";
import { CONFIG } from "../config";
import { MIGRATIONS } from "./migrations";
import { mkdirSync } from "node:fs";
import path from "node:path";

let dbSingleton: Database | null = null;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function getDb(): Database {
  if (dbSingleton) return dbSingleton;
  mkdirSync(path.dirname(CONFIG.dbPath), { recursive: true });
  const db = new Database(CONFIG.dbPath, { create: true });
  db.exec("PRAGMA foreign_keys=ON;");
  dbSingleton = db;
  return db;
}

export function migrateDb(): void {
  const db = getDb();
  let appliedRows: { id: string }[] = [];
  try {
    appliedRows = db.query<{ id: string }, []>("SELECT id FROM schema_migrations").all();
  } catch {
    appliedRows = [];
  }
  const applied = new Set<string>(appliedRows.map(r => r.id));

  const tx = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      db.exec(migration.up);
      db.query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, nowUnix());
    }
  });
  tx();
}
