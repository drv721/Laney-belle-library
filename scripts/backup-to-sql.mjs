// node scripts/backup-to-sql.mjs <nightly copy .json> <restore .sql>
// Reads one nightly copy and writes the SQL that puts the library back as it
// was that night. It only writes the .sql file; nothing touches a database
// until you run that file with wrangler (README: Backups and restoring).

import { readFileSync, writeFileSync } from "node:fs";
import { backupToSql } from "../src/restore-sql.js";

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error("Usage: node scripts/backup-to-sql.mjs <nightly copy .json> <restore .sql>");
  process.exit(1);
}
try {
  const snapshot = JSON.parse(readFileSync(from, "utf8"));
  const { sql, counts, warnings } = backupToSql(snapshot);
  writeFileSync(to, sql);
  console.log(`Copy made ${snapshot.made_at}. Wrote ${to}.`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
  for (const w of warnings) console.log(`Note: ${w}`);
} catch (err) {
  console.error(`Couldn't make the restore file: ${err.message}`);
  process.exit(1);
}
