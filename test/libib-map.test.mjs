import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapLibibCsv } from "../public/libib-map.js";

const out = mapLibibCsv(readFileSync(new URL("./sample-libib.csv", import.meta.url), "utf8"), { fileName: "sample-libib.csv" });

test("reads every row and skips blank ones", () => assert.equal(out.rows.length, 3));
test("keeps a comma inside an author's name", () => assert.deepEqual(out.rows[0].book.authors, ["Morrison, Toni"]));
test("splits authors on a semicolon", () => assert.deepEqual(out.rows[2].book.authors, ["Someone", "Another"]));
test("status labels become codes, any case", () => {
  assert.equal(out.rows[0].item.status_code, "completed");
  assert.equal(out.rows[1].item.status_code, "completed");
  assert.equal(out.rows[2].item.status_code, "not_begun");
});
test("ISBN-10 fills in ISBN-13 and both copies match as duplicates", () => {
  assert.equal(out.rows[1].book.isbn13, "9780306406157");
  assert.deepEqual(out.duplicates, [{ key: "isbn:9780306406157", rowNumbers: [2, 3] }]);
});
test("quotes and line breaks inside a cell survive", () => assert.equal(out.rows[0].book.description, 'A "ghost" story\nwith two lines'));
test("price, rating, pages, copies, dates", () => {
  const r = out.rows[0];
  assert.equal(r.item.purchase_price, 17.99);
  assert.equal(r.item.rating, 4.5);
  assert.equal(r.book.pages, 324);
  assert.equal(r.item.began_date, "2024-03-02");
  assert.equal(out.rows[1].item.copies, 2);
});
test("tags and group", () => {
  assert.deepEqual(out.rows[0].tags, ["fiction", "classics"]);
  assert.equal(out.rows[0].group, "Living room");
});
test("bad values are flagged, not guessed", () => {
  const w = out.rows[2].warnings.join(" | ");
  assert.match(w, /ean_isbn13/); assert.match(w, /upc_isbn10/); assert.match(w, /status/); assert.match(w, /rating/); assert.match(w, /added: kept "03\/04\/2024"/);
});
test("unknown headers are reported and kept raw", () => {
  assert.deepEqual(out.unknownHeaders, ["some_new_column"]);
  assert.equal(out.rows[0].raw["Some New Column"], "x");
});
