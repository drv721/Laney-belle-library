import test from "node:test";
import assert from "node:assert/strict";
import { normTitle, matchLine, freeCopy, rowSpots, chunks } from "../public/shelf.js";
import { spotLine } from "../public/hub.js";
import { checkSpot } from "../src/shelf.js";

const ID = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const books = [
  { id: ID(1), book_id: "b1", title: "The Wonderful Wizard of Oz", authors: ["L. Frank Baum"], isbn13: "9780140621679", isbn10: "0140621679" },
  { id: ID(2), book_id: "b2", title: "Dracula", authors: ["Bram Stoker"], isbn13: null },
  { id: ID(3), book_id: "b3", title: "Dracula", authors: ["Dacre Stoker", "J. D. Barker"], isbn13: null },
  { id: ID(4), book_id: "b4", title: "Solo", authors: ["Kwame Alexander"], isbn13: null },
  { id: ID(5), book_id: "b4", title: "Solo", authors: ["Kwame Alexander"], isbn13: null },
  { id: ID(6), book_id: "b6", title: "Café Society", authors: ["Ann Smith"], isbn13: null },
];

test("titles match without case, accents, punctuation or a leading The", () => {
  assert.equal(normTitle("The Wonderful Wizard of Oz!"), "wonderful wizard of oz");
  assert.equal(normTitle("Café  Society"), "cafe society");
  assert.equal(matchLine("cafe society", books).kind, "one");
});

test("a pasted ISBN finds its copy, with or without dashes", () => {
  assert.deepEqual(matchLine("978-0-14-062167-9", books).books.map((b) => b.id), [ID(1)]);
  assert.deepEqual(matchLine("0140621679", books).books.map((b) => b.id), [ID(1)]);
  assert.equal(matchLine("9780000000002", books).kind, "none");
});

test("a title shared by two books needs the author", () => {
  assert.equal(matchLine("Dracula", books).kind, "many");
  const m = matchLine("Dracula by Bram Stoker", books);
  assert.equal(m.kind, "one");
  assert.deepEqual(m.books.map((b) => b.id), [ID(2)]);
  assert.deepEqual(matchLine("Dracula - Barker", books).books.map((b) => b.id), [ID(3)]);
});

test("two copies of one book count as one match", () => {
  assert.equal(matchLine("Solo", books).kind, "one");
  assert.equal(matchLine("2. Solo", books).kind, "one");
});

test("a title that starts the full one still matches, a blank line is skipped", () => {
  assert.equal(matchLine("Wonderful Wizard", books).kind, "one");
  assert.equal(matchLine("   ", books).kind, "skip");
  assert.equal(matchLine("Not A Book Here", books).kind, "none");
});

test("the row takes a copy that isn't on it yet", () => {
  const copies = books.filter((b) => b.book_id === "b4");
  assert.equal(freeCopy(copies, []).id, ID(4));
  assert.equal(freeCopy(copies, [ID(4)]).id, ID(5));
  assert.equal(freeCopy(copies, [ID(4), ID(5)]), null);
});

test("Save row numbers the books left to right and takes off the ones she removed", () => {
  const spots = rowSpots("loc-1", 3, [ID(2), ID(1)], [ID(1), ID(4)]);
  assert.deepEqual(spots, [
    { id: ID(2), location_id: "loc-1", shelf_row: 3, shelf_pos: 1 },
    { id: ID(1), location_id: "loc-1", shelf_row: 3, shelf_pos: 2 },
    { id: ID(4), location_id: "loc-1", shelf_row: null, shelf_pos: null },
  ]);
});

test("chunks splits a long row into calls of 200", () => {
  assert.deepEqual(chunks(Array.from({ length: 450 }, (_, i) => i)).map((c) => c.length), [200, 200, 50]);
});

test("the spot line shows the row and spot once a book is placed", () => {
  assert.equal(spotLine({ location: "BILLY 2", shelf_row: 3, shelf_pos: 5, shelf_word: "Row" }), "BILLY 2 · Row 3, spot 5");
  assert.equal(spotLine({ location: "Kitchen counter case", shelf_row: 4, shelf_word: "Cubby" }), "Kitchen counter case · Cubby 4");
  assert.equal(spotLine({ location: "BILLY 1", shelf_location: "Top shelf, left" }), "BILLY 1 · Top shelf, left");
});

test("the server checks each spot against the place's rows", () => {
  const places = new Map([["loc-1", { name: "BILLY 1", shelf_count: 6, shelf_word: "Row" }], ["loc-5", { name: "Kitchen counter case", shelf_count: 7, shelf_word: "Cubby" }]]);
  const ok = { id: ID(1), location_id: "loc-1", shelf_row: 6, shelf_pos: 12 };
  assert.equal(checkSpot(ok, places), null);
  assert.equal(checkSpot({ ...ok, shelf_row: 7 }, places), "BILLY 1 has 6 rows.");
  assert.equal(checkSpot({ ...ok, location_id: "loc-5", shelf_row: 8 }, places), "Kitchen counter case has 7 cubbies.");
  assert.equal(checkSpot({ ...ok, location_id: "nope" }, places), "That location doesn't exist.");
  assert.equal(checkSpot({ id: ID(1), location_id: null, shelf_row: 2, shelf_pos: null }, places), "A row needs a location.");
  assert.equal(checkSpot({ id: ID(1), location_id: null, shelf_row: null, shelf_pos: null }, places), null);
  assert.equal(checkSpot({ ...ok, shelf_row: 1.5 }, places), "BILLY 1 has 6 rows.");
  assert.equal(checkSpot({ ...ok, id: "x" }, places), "Those books weren't recognised.");
});
