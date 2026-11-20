import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { TABLES } from "../src/tables.js";
import { backupToSql, sqlValue } from "../src/restore-sql.js";

const migrations = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
const created = migrations.flatMap((m) => [...m.matchAll(/CREATE TABLE (\w+)/g)].map((x) => x[1]));

test("the nightly copy saves every table the migrations make", () => {
  assert.deepEqual([...created].sort(), [...TABLES].sort());
});

test("each table comes after the tables it points to", () => {
  // Table -> tables it references, from CREATE TABLE bodies and ALTER TABLE ... REFERENCES.
  const refs = {};
  for (const m of migrations) {
    for (const [, t, body] of m.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\n\);/g)) {
      refs[t] = [...body.matchAll(/REFERENCES (\w+)/g)].map((x) => x[1]);
    }
    for (const [, t, p] of m.matchAll(/ALTER TABLE (\w+) ADD COLUMN \w+ \w+ REFERENCES (\w+)/g)) refs[t].push(p);
  }
  for (const [t, parents] of Object.entries(refs)) {
    for (const p of parents) assert.ok(TABLES.indexOf(p) < TABLES.indexOf(t), `${p} should come before ${t}`);
  }
});

test("values are written safely", () => {
  assert.equal(sqlValue("O'Brien"), "'O''Brien'");
  assert.equal(sqlValue(null), "NULL");
  assert.equal(sqlValue(4.5), "4.5");
  assert.throws(() => sqlValue(NaN));
  assert.throws(() => backupToSql({}), /nightly copies/);
});

test("a copy from before Nov 21 keeps the database's own subcategories and locations", () => {
  const { sql, warnings } = backupToSql({
    made_at: "2026-11-20T08:00:00Z", version: 1,
    tables: { books: [{ id: "b1", title: "Dracula" }], shelf_items: [{ id: "s1", book_id: "b1", location_id: "loc-2", subcategory_id: null }] },
  });
  assert.doesNotMatch(sql, /DELETE FROM locations/);
  assert.match(sql, /\(SELECT id FROM locations WHERE id = 'loc-2'\)/);
  assert.equal(warnings.filter((w) => /locations|subcategories/.test(w)).length, 2);
});

// The whole way round on a real SQLite database: a library, its copy, the
// restore into an empty database, and the same rows out the other side.
let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch { /* Node before 22.5: skipped */ }
test("a copy restores to exactly the same rows", { skip: !sqlite && "needs Node 22.5 or later" }, () => {
  const fresh = () => {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const m of migrations) db.exec(m);
    return db;
  };
  const dump = (db) => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
  const a = fresh();
  a.exec(`
    INSERT INTO books (id, title, authors) VALUES ('b1', 'Hamlet', '["William Shakespeare"]'), ('b2', 'It''s Kind of a Funny Story', '[]');
    INSERT INTO subcategories (id, collection_id, name) VALUES ('sub1', 'default', 'Classics');
    INSERT INTO shelf_items (id, book_id, status_code, subcategory_id, location_id, notes, purchase_price)
      VALUES ('s1', 'b1', 'completed', 'sub1', 'loc-3', 'Line one
line two', 12.5), ('s2', 'b2', 'not_begun', NULL, NULL, NULL, NULL);
    INSERT INTO tags (id, name) VALUES ('t1', 'Signed');
    INSERT INTO shelf_item_tags (shelf_item_id, tag_id) VALUES ('s1', 't1');
    INSERT INTO custom_fields (id, name, field_type) VALUES ('f1', 'Gift from', 'text');
    INSERT INTO custom_values (shelf_item_id, field_id, value) VALUES ('s1', 'f1', 'Mom');
    INSERT INTO change_log (by_email, entity, entity_id, action) VALUES ('x@example.com', 'shelf_item', 's1', 'create');
    INSERT INTO import_batches (id, file_name) VALUES ('i1', 'library.csv');
    INSERT INTO libib_rows (id, batch_id, row_number, row_json, shelf_item_id) VALUES ('r1', 'i1', 1, '{"title":"Hamlet"}', 's1');
  `);
  const before = dump(a);
  const b = fresh(); // a new database: its migration seed rows get replaced too
  b.exec(backupToSql({ made_at: "now", version: 2, tables: before }).sql);
  assert.deepEqual(dump(b), before);
  assert.deepEqual(b.prepare("PRAGMA foreign_key_check").all(), []);
  // And over a database that already has other books in it.
  b.exec("INSERT INTO books (id, title) VALUES ('b9', 'Extra')");
  b.exec(backupToSql({ made_at: "now", version: 2, tables: before }).sql);
  assert.deepEqual(dump(b), before);
});
