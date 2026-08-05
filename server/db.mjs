import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DATABASE_PATH = resolve(process.cwd(), "data/hkc.sqlite");

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
}

export function openDatabase(databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  const resolvedPath = resolve(databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      access_expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      redeemed INTEGER NOT NULL DEFAULT 0 CHECK (redeemed IN (0, 1)),
      redeemed_by_user_id INTEGER,
      redeemed_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cohort_access_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      cohort_key TEXT NOT NULL,
      source TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cohort_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cohort_access_code_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE,
      redeemed_at TEXT NOT NULL,
      FOREIGN KEY (cohort_access_code_id) REFERENCES cohort_access_codes(id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_ref TEXT NOT NULL,
      cohort_key TEXT,
      event_name TEXT NOT NULL,
      properties_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      first_ref TEXT NOT NULL,
      cohort_key TEXT,
      helpful_rating INTEGER,
      ease_rating INTEGER,
      most_useful TEXT,
      missing_text TEXT,
      outcome TEXT,
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(db, "analytics_events", "cohort_key", "TEXT");
  ensureColumn(db, "candidate_feedback", "cohort_key", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_cohort_codes_key ON cohort_access_codes(cohort_key);
    CREATE INDEX IF NOT EXISTS idx_cohort_codes_source ON cohort_access_codes(source);
    CREATE INDEX IF NOT EXISTS idx_cohort_redemptions_code ON cohort_redemptions(cohort_access_code_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_events(visitor_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_session ON analytics_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_ref ON analytics_events(first_ref);
    CREATE INDEX IF NOT EXISTS idx_analytics_cohort ON analytics_events(cohort_key);
    CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event_name);
    CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_ref ON candidate_feedback(first_ref);
    CREATE INDEX IF NOT EXISTS idx_feedback_cohort ON candidate_feedback(cohort_key);
  `);

  return db;
}

export function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function normaliseCode(value) {
  return String(value || "").trim().toUpperCase();
}
