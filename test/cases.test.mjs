import test from "node:test";
import assert from "node:assert/strict";
import { spineLook, layoutPlace, byRoom, countLine, SPINES } from "../public/cases.js";

const place = { id: "loc-billy-1", name: "BILLY 1", room: "Living room", shelf_count: 6, shelf_word: "Row" };
const book = (id, extra) => ({ id, book_id: `b-${id}`, title: `Book ${id}`, authors: [], location_id: "loc-billy-1", ...extra });

test("books stand on their rows in spot order", () => {
  const books = [
    book("a", { shelf_row: 1, shelf_pos: 2 }),
    book("b", { shelf_row: 1, shelf_pos: 1 }),
    book("c", { shelf_row: 3, shelf_pos: 1 }),
    book("d", { shelf_row: null }),
    book("e", { shelf_row: 9, shelf_pos: 1 }), // a row the case doesn't have
    book("f", { location_id: "loc-kitchen", shelf_row: 1, shelf_pos: 1 }),
  ];
  const out = layoutPlace(place, books, 6);
  assert.equal(out.rows.length, 6);
  assert.deepEqual(out.rows[0].map((b) => b.id), ["b", "a"]);
  assert.deepEqual(out.rows[2].map((b) => b.id), ["c"]);
  assert.deepEqual(out.loose.map((b) => b.id), ["d", "e"]);
});

test("a book with a row but no spot goes after the placed ones", () => {
  const out = layoutPlace(place, [book("x", { shelf_row: 2 }), book("y", { shelf_row: 2, shelf_pos: 5 })], 6);
  assert.deepEqual(out.rows[1].map((b) => b.id), ["y", "x"]);
});

test("a book keeps its look, and copies of one book match", () => {
  const a = spineLook({ id: "1", book_id: "same", pages: 300 });
  const b = spineLook({ id: "2", book_id: "same", pages: 300 });
  assert.deepEqual(a, b);
  assert.ok(SPINES.includes(a.color));
  assert.ok(a.height >= 78 && a.height < 98);
  assert.ok(spineLook({ id: "z", pages: 2000 }).width <= 44);
  assert.ok(spineLook({ id: "z", pages: 20 }).width >= 16);
});

test("places group by room in her order, with no room last", () => {
  const out = byRoom([
    { id: "1", room: "Living room" }, { id: "2", room: "" }, { id: "3", room: "Kitchen" }, { id: "4", room: "Living room" },
  ]);
  assert.deepEqual(out.map((g) => g.room), ["Living room", "Kitchen", ""]);
  assert.deepEqual(out[0].places.map((p) => p.id), ["1", "4"]);
});

test("the count line names rows, cubbies and shelves", () => {
  const layout = { rows: [[1, 2], [3], [], [], [], [], []], loose: [4] };
  assert.equal(countLine(place, layout, "Cubby"), "3 books on 7 cubbies, and 1 book here with no cubby yet.");
  assert.equal(countLine(place, { rows: [[1], []], loose: [] }, "Shelf"), "1 book on 2 shelves.");
  assert.equal(countLine(place, { rows: [[]], loose: [] }, "Row"), "0 books on 1 row.");
});
