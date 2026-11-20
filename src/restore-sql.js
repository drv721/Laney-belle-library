// Turns one nightly copy (the JSON file in R2) into SQL that puts the library
// back exactly as it was that night. Used by scripts/backup-to-sql.mjs.
//
// The SQL empties every table the copy holds and refills it row by row, so
// run it only on a database you mean to replace: a practice copy on the Mac,
// or the live one after saving a Time Travel bookmark (README explains both).
// It never creates or drops tables; the database needs its migrations first.
//
// Copies made before Nov 21, 2026 (version 1) left out subcategories and
// locations. For those two the SQL keeps what the database already has, and
// a book only keeps its subcategory or location if that one exists there.

import { TABLES } from "./tables.js";

export const STATEMENT_MAX = 100000; // D1's limit on one statement, in bytes

export function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`A number in the copy isn't a real number: ${v}`);
    return String(v);
  }
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`The copy has a value that isn't text, a number or empty: ${JSON.stringify(v)}`);
}

// Columns that point at a table the copy left out: keep the link only if the row is there.
const LINKS = { shelf_items: { subcategory_id: "subcategories", location_id: "locations" } };

export function backupToSql(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error("That file isn't one of the library's nightly copies.");
  }
  const warnings = [];
  const present = TABLES.filter((t) => Array.isArray(snapshot.tables[t]));
  const missing = TABLES.filter((t) => !present.includes(t));
  for (const t of missing) warnings.push(`The copy has no ${t} table, so the database keeps the ${t} it already has.`);
  for (const t of Object.keys(snapshot.tables)) if (!TABLES.includes(t)) warnings.push(`Skipped ${t}: the app doesn't use that table.`);
  if (!present.includes("books") || !present.includes("shelf_items")) throw new Error("That copy has no books in it.");

  const counts = {};
  const lines = [
    `-- Restore of the nightly copy made ${snapshot.made_at ?? "(date not recorded)"}`,
    snapshot.migrations ? `-- The database needs these migrations first: ${snapshot.migrations.join(", ")}` : "-- The copy doesn't list its migrations; apply every migration first.",
    "PRAGMA defer_foreign_keys = true;",
  ];
  for (const t of [...present].reverse()) lines.push(`DELETE FROM ${t};`);
  for (const t of present) {
    const rows = snapshot.tables[t];
    counts[t] = rows.length;
    for (const row of rows) {
      const cols = Object.keys(row);
      if (!cols.length) continue;
      const vals = cols.map((c) => {
        const target = LINKS[t]?.[c];
        if (target && missing.includes(target) && row[c] !== null && row[c] !== undefined) {
          return `(SELECT id FROM ${target} WHERE id = ${sqlValue(row[c])})`;
        }
        return sqlValue(row[c]);
      });
      const stmt = `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
      if (new TextEncoder().encode(stmt).length > STATEMENT_MAX) {
        throw new Error(`One ${t} row is too big for one statement (${STATEMENT_MAX} bytes).`);
      }
      lines.push(stmt);
    }
  }
  return { sql: lines.join("\n") + "\n", counts, warnings };
}
