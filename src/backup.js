// Nightly copy of the whole library to R2, keeping the last BACKUP_KEEP days.
// Reads every table through the D1 binding and writes one JSON file per night,
// so no API token has to be stored anywhere. scripts/backup-to-sql.mjs turns
// one of these files back into a database (README: Backups and restoring).

import { TABLES } from "./tables.js";

export async function backupToR2(env) {
  const day = new Date().toISOString().slice(0, 10);
  const results = await env.DB.batch(TABLES.map((t) => env.DB.prepare(`SELECT * FROM ${t}`)));
  const snapshot = { made_at: new Date().toISOString(), version: 2, migrations: await migrationNames(env), tables: {} };
  TABLES.forEach((t, i) => (snapshot.tables[t] = results[i].results));

  const key = `nightly/${day}.json`;
  await env.BACKUPS.put(key, JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json" },
  });

  // Keep the newest N, delete older ones.
  const keep = Number(env.BACKUP_KEEP || 30);
  const keys = [];
  let cursor;
  do {
    const page = await env.BACKUPS.list({ prefix: "nightly/", cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort(); // dates sort as text
  const old = keys.slice(0, Math.max(0, keys.length - keep));
  if (old.length) await env.BACKUPS.delete(old);

  console.log(`backup ${key} written, ${old.length} old copies removed`);
  return { key, removed: old.length };
}

// Which database changes had run when the copy was made, so a restore knows
// what the database it goes into needs first. The copy still saves without it.
async function migrationNames(env) {
  try {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all();
    return results.map((r) => r.name);
  } catch {
    return null;
  }
}
