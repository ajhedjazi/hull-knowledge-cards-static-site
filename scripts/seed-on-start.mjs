import { openDatabase, normaliseCode } from "../server/db.mjs";

const rawAccessSeed = String(process.env.ACCESS_CODE_SEED || "").trim();
const rawCohortSeed = String(process.env.COHORT_ACCESS_SEED || "").trim();

if (!rawAccessSeed && !rawCohortSeed) {
  process.exit(0);
}

const db = openDatabase();
const now = new Date().toISOString();

if (rawAccessSeed) {
  const codes = rawAccessSeed
    .split(",")
    .map(normaliseCode)
    .filter(Boolean);

  if (codes.length) {
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
  }
}

if (rawCohortSeed) {
  const records = rawCohortSeed
    .split(";")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [rawCode, rawCohort, rawSource, rawExpiry] = record.split("|").map((part) => String(part || "").trim());
      const code = normaliseCode(rawCode);
      const cohortKey = rawCohort.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
      const source = rawSource.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 64);
      const expiry = new Date(rawExpiry);
      if (!code || !cohortKey || !source || Number.isNaN(expiry.getTime())) {
        throw new Error(`Invalid COHORT_ACCESS_SEED record: ${record}`);
      }
      return { code, cohortKey, source, expiresAt: expiry.toISOString() };
    });

  db.exec("BEGIN IMMEDIATE;");
  try {
    const upsert = db.prepare(`
      INSERT INTO cohort_access_codes (code, cohort_key, source, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        cohort_key = excluded.cohort_key,
        source = excluded.source,
        expires_at = excluded.expires_at
      WHERE cohort_access_codes.revoked_at IS NULL
    `);
    for (const record of records) {
      upsert.run(record.code, record.cohortKey, record.source, record.expiresAt, now);
    }
    db.exec("COMMIT;");
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch { /* transaction already closed */ }
    throw error;
  }

  console.log(`Cohort access startup seed complete: ${records.length} configured.`);
}
