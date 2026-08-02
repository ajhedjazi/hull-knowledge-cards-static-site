import { openDatabase, normaliseCode } from "../server/db.mjs";

const db = openDatabase();
const [command, ...args] = process.argv.slice(2);
const now = () => new Date().toISOString();

function addCode(rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) throw new Error("Access code cannot be empty.");
  db.prepare(
    "INSERT OR IGNORE INTO access_codes (code, redeemed, created_at) VALUES (?, 0, ?)",
  ).run(code, now());
}

function seed() {
  const codes = String(process.env.ACCESS_CODE_SEED || "")
    .split(",")
    .map(normaliseCode)
    .filter(Boolean);
  if (!codes.length) throw new Error("Set ACCESS_CODE_SEED to a comma-separated list of codes before seeding.");
  db.exec("BEGIN IMMEDIATE;");
  try {
    for (const code of codes) addCode(code);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  console.log(`Seeded ${codes.length} access code(s). Existing codes were left unchanged.`);
}

function status(rawCode) {
  const code = normaliseCode(rawCode);
  if (code) {
    const row = db.prepare(`
      SELECT access_codes.code, access_codes.redeemed, access_codes.redeemed_at,
             access_codes.revoked_at, users.email, users.access_expires_at
      FROM access_codes
      LEFT JOIN users ON users.id = access_codes.redeemed_by_user_id
      WHERE access_codes.code = ?
    `).get(code);
    console.table(row ? [row] : []);
    return;
  }

  const rows = db.prepare(`
    SELECT access_codes.code, access_codes.redeemed, access_codes.redeemed_at,
           access_codes.revoked_at, users.email, users.access_expires_at
    FROM access_codes
    LEFT JOIN users ON users.id = access_codes.redeemed_by_user_id
    ORDER BY access_codes.id
  `).all();
  console.table(rows);
}

function revoke(rawCode) {
  const code = normaliseCode(rawCode);
  const result = db.prepare(`
    UPDATE access_codes SET revoked_at = ?
    WHERE code = ? AND redeemed = 0 AND revoked_at IS NULL
  `).run(now(), code);
  if (result.changes !== 1) throw new Error("Code was not found, is already redeemed, or is already revoked.");
  console.log(`Revoked unused code ${code}.`);
}

try {
  if (command === "seed") seed();
  else if (command === "add") {
    if (!args[0]) throw new Error("Usage: npm run codes -- add CODE");
    addCode(args[0]);
    console.log(`Added access code ${normaliseCode(args[0])}.`);
  } else if (command === "status") status(args[0]);
  else if (command === "revoke") {
    if (!args[0]) throw new Error("Usage: npm run codes -- revoke CODE");
    revoke(args[0]);
  } else {
    console.log("Commands: seed | add CODE | status [CODE] | revoke CODE");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
