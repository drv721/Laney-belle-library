import { test } from "node:test";
import assert from "node:assert/strict";
import { readScan, isbn13To10 } from "../public/isbn.js";
import { lookupBook, searchBooks } from "../src/covers.js";

test("ISBN-13 from a scan", () => {
  assert.deepEqual(readScan("9780980200447"), { kind: "isbn", isbn13: "9780980200447", isbn10: "098020044X" });
});
test("ISBN-10 typed with dashes", () => {
  const r = readScan("0-9802004-4-x");
  assert.equal(r.kind, "isbn");
  assert.equal(r.isbn13, "9780980200447");
});
test("ISBN-10 ending in X", () => {
  const r = readScan("080442957x");
  assert.equal(r.kind, "isbn");
  assert.equal(r.isbn10, "080442957X");
  assert.equal(isbn13To10(r.isbn13), "080442957X");
});
test("979 ISBN has no ISBN-10", () => {
  const r = readScan("9791032305690");
  assert.equal(r.kind, "isbn");
  assert.equal(r.isbn10, null);
});
test("price add-on digits are dropped", () => {
  assert.equal(readScan("978098020044751299").isbn13, "9780980200447");
  assert.equal(readScan("978098020044712").isbn13, "9780980200447");
});
test("bad check digit, UPC, partial, too long", () => {
  assert.equal(readScan("9780980200448").kind, "bad");
  assert.equal(readScan("012345678905").kind, "upc");
  assert.equal(readScan("97809802").kind, "partial");
  assert.equal(readScan("97809802004471234567").kind, "bad");
  assert.equal(readScan("4006381333931").kind, "upc"); // a valid EAN that isn't a book
  assert.equal(readScan("0012345678905").kind, "upc"); // a UPC as a camera reader reports it
});

test("lookupBook reads Open Library's data shape", async () => {
  const sample = {
    "ISBN:9780980200447": {
      title: "Slow reading",
      authors: [{ name: "John Miedema", url: "https://openlibrary.org/authors/OL6548935A/John_Miedema" }],
      publishers: [{ name: "Litwin Books" }],
      publish_date: "2009",
      number_of_pages: 80,
      cover: { small: "https://covers.openlibrary.org/b/id/5546156-S.jpg", large: "https://covers.openlibrary.org/b/id/5546156-L.jpg" },
    },
  };
  let asked;
  globalThis.fetch = async (url, opts) => { asked = { url, opts }; return new Response(JSON.stringify(sample)); };
  const b = await lookupBook({}, "9780980200447");
  assert.match(asked.url, /bibkeys=ISBN:9780980200447/);
  assert.equal(asked.opts.headers["User-Agent"], "MelanieLibrary/1.0");
  assert.deepEqual(b, {
    title: "Slow reading", subtitle: null, authors: ["John Miedema"], publisher: "Litwin Books",
    publish_date: "2009", pages: 80, cover_url: "https://covers.openlibrary.org/b/id/5546156-M.jpg",
  });
  globalThis.fetch = async () => new Response("{}");
  assert.equal(await lookupBook({}, "9780980200447"), null);
  globalThis.fetch = async () => new Response("no", { status: 503 });
  await assert.rejects(lookupBook({}, "9780980200447"));
});

test("searchBooks asks by title and author and keeps only edition-safe fields", async () => {
  // Shape from the sample on openlibrary.org/dev/docs/api/search.
  const sample = {
    start: 0, num_found: 2,
    docs: [
      { key: "/works/OL27448W", title: "The Lord of the Rings", author_name: ["J. R. R. Tolkien"], first_publish_year: 1954, cover_i: 258027, edition_count: 120 },
      { key: "/works/OL1W", title: "  ", author_name: ["Nobody"] },
      { key: "/works/OL2W", title: "Untitled draft", cover_i: -1 },
    ],
  };
  let asked;
  globalThis.fetch = async (url) => { asked = new URL(url); return new Response(JSON.stringify(sample)); };
  const r = await searchBooks({}, "lord of the rings", "tolkien");
  assert.equal(asked.pathname, "/search.json");
  assert.equal(asked.searchParams.get("title"), "lord of the rings");
  assert.equal(asked.searchParams.get("author"), "tolkien");
  assert.equal(asked.searchParams.get("limit"), "8");
  assert.deepEqual(r, [
    { title: "The Lord of the Rings", subtitle: null, authors: ["J. R. R. Tolkien"], first_year: 1954, editions: 120, cover_url: "https://covers.openlibrary.org/b/id/258027-M.jpg" },
    { title: "Untitled draft", subtitle: null, authors: [], first_year: null, editions: null, cover_url: null },
  ]);
  await searchBooks({}, "dune", "");
  assert.equal(asked.searchParams.has("author"), false);
});
