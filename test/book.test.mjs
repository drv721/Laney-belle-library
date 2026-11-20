import { test } from "node:test";
import assert from "node:assert/strict";
import { readChanges } from "../public/book.js";

const item = {
  title: "Dracula", subtitle: null, authors: ["Bram Stoker"], isbn13: null, isbn10: null, publisher: null,
  publish_date: null, description: null, pages: null, status_code: "not_begun", list_code: "owned",
  collection_id: "default", copies: 1, shelf_location: null, condition: null, added_date: "2025-12-26",
  began_date: null, completed_date: null, rating: null, review_date: null, review: null, notes: null,
  purchase_place: null, purchase_date: null, purchase_price: null,
};
function form(over = {}) {
  const v = {
    ...Object.fromEntries(Object.entries(item).map(([k, x]) => [k, x == null ? "" : String(x)])),
    authors: item.authors.join("\n"), ...over,
  };
  return { elements: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }])) };
}

test("nothing changed sends nothing", () => assert.deepEqual(readChanges(form(), item), { changes: {} }));
test("sends only what changed", () => {
  assert.deepEqual(readChanges(form({ pages: "418", shelf_location: " Living room " }), item).changes,
    { pages: 418, shelf_location: "Living room" });
});
test("one author per line, so a comma stays inside a name", () => {
  assert.deepEqual(readChanges(form({ authors: "Marc Brackett, Ph.D.\n\nEdward Gorey (Illustrator)" }), item).changes,
    { authors: ["Marc Brackett, Ph.D.", "Edward Gorey (Illustrator)"] });
});
test("a valid ISBN-10 fills in the ISBN-13", () => {
  assert.deepEqual(readChanges(form({ isbn10: "0-306-40615-2" }), item).changes, { isbn10: "0306406152", isbn13: "9780306406157" });
});
test("a bad ISBN, empty title or odd number is refused with a reason", () => {
  assert.match(readChanges(form({ isbn13: "978006307619" }), item).error, /ISBN-13/);
  assert.match(readChanges(form({ title: "  " }), item).error, /title/);
  assert.match(readChanges(form({ rating: "7" }), item).error, /Rating/);
  assert.match(readChanges(form({ copies: "0" }), item).error, /Copies/);
});
test("clearing a box clears the field; clearing copies keeps it", () => {
  assert.deepEqual(readChanges(form({ added_date: "", copies: "" }), item).changes, { added_date: null });
});
