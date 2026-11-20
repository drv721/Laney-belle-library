import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapLibibCsv } from "../public/libib-map.js";

const out = mapLibibCsv(readFileSync(new URL("./sample-libib.csv", import.meta.url), "utf8"), { fileName: "sample-libib.csv" });

test("reads every row and skips blank ones", () => assert.equal(out.rows.length, 3));
test("a comma between names is two authors", () => assert.deepEqual(out.rows[0].book.authors, ["Morrison", "Toni"]));
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

// The real export's header names (Nov 2026), with made-up rows.
import { splitAuthors, mightBeSame } from "../public/libib-map.js";
const real = mapLibibCsv(readFileSync(new URL("./sample-libib-export.csv", import.meta.url), "utf8"), { fileName: "library.csv" });

test("real export: no unknown or missing columns", () => {
  assert.deepEqual(real.unknownHeaders, []);
  assert.deepEqual(real.missingHeaders, []);
});
test("real export: length is pages, began and completed are dates", () => {
  assert.equal(real.rows[0].book.pages, 368);
  assert.equal(real.rows[0].item.began_date, "2025-01-02");
  assert.equal(real.rows[0].item.completed_date, "2025-02-03");
});
test("real export: several authors, a PhD stays with its name, roles stay", () => {
  assert.deepEqual(real.rows[0].book.authors, ["Ann Writer, PhD", "Bo Helper (Illustrator)"]);
  assert.deepEqual(real.rows[1].book.authors, ["Cy Solo"]);
});
test("real export: an ISBN-10 in the ISBN-13 column is used", () => {
  assert.equal(real.rows[1].book.isbn10, "0306406152");
  assert.equal(real.rows[1].book.isbn13, "9780306406157");
  assert.deepEqual(real.rows[1].warnings, []);
});
test("real export: a jumbled author cell is flagged", () => assert.match(real.rows[2].warnings.join(), /creators/));
test("Last, First for the listed author is one person", () => {
  assert.deepEqual(splitAuthors("Morrison, Toni", "Toni", "Morrison"), ["Toni Morrison"]);
});
test("might be the same book: missing author or ISBN, not two editions", () => {
  assert.equal(mightBeSame({ title: "Solo", authors: [] }, { title: "solo", authors: ["Kwame Alexander"] }), true);
  assert.equal(mightBeSame({ title: "Dracula", authors: ["Bram Stoker"], isbn13: "9780306406157" }, { title: "Dracula", authors: ["Bram Stoker"] }), true);
  assert.equal(mightBeSame({ title: "Oz", authors: ["A"], isbn13: "9780306406157" }, { title: "Oz", authors: ["A"], isbn13: "9781401603908" }), false);
  assert.equal(mightBeSame({ title: "Solo", authors: ["X"] }, { title: "Solo", authors: ["Y"] }), false);
});
