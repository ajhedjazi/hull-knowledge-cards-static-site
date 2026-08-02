import { openDatabase, normaliseCode } from "../server/db.mjs";

const rawSeed = String(process.env.ACCESS_CODE_SEED || "").trim();

if (!rawSeed) {
  process.exit(0);
}

const codes = rawSeed
  .split(",")
  .map(normaliseCode)
  .filter(Boolean);

if (!codes.length) {
  console.log("ACCESS_CODE_SEED was set but contained no valid codes; nothing to seed.");
  process.exit(0);
}

const db = openDatabase();
const now = new Date().toISOString();

let inserted = 0;
db.exec("BEGIN IMMEDIATE;");
try {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO access_codes (code, redeemed, created_at) VALUES (?, 0, ?)",
  );
  for (const code of codes) {
    const result = insert.run(code, now);
    inserted += result.changes;
  }
  db.exec("COMMIT;");
} catch (error) {
  try { db.exec("ROLLBACK;"); } catch { /* transaction already closed */ }
  throw error;
}

console.log(`Access-code startup seed complete: ${inserted} new, ${codes.length - inserted} already present.`);
