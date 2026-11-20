import test from "node:test";
import assert from "node:assert/strict";
import { KEEP, chunks, bulkChanges, undoGroups, applyBulk, undoBulk, summary } from "../public/select.js";

test("chunks splits into calls of 100", () => {
  const ids = Array.from({ length: 251 }, (_, i) => String(i));
  assert.deepEqual(chunks(ids).map((c) => c.length), [100, 100, 51]);
});

test("Leave as is sends nothing; None sends null", () => {
  assert.deepEqual(bulkChanges(KEEP, KEEP), {});
  assert.deepEqual(bulkChanges("sub-1", KEEP), { subcategory_id: "sub-1" });
  assert.deepEqual(bulkChanges("", "loc-2"), { subcategory_id: null, location_id: "loc-2" });
});

test("undo groups books by what they had before, only for the fields that changed", () => {
  const before = [
    { id: "a", subcategory_id: null, location_id: "loc-1" },
    { id: "b", subcategory_id: "s1", location_id: "loc-1" },
    { id: "c", subcategory_id: null, location_id: "loc-2" },
  ];
  assert.deepEqual(undoGroups(before, ["subcategory_id"]), [
    { values: { subcategory_id: null }, ids: ["a", "c"] },
    { values: { subcategory_id: "s1" }, ids: ["b"] },
  ]);
  assert.equal(undoGroups(before, ["subcategory_id", "location_id"]).length, 3);
});

test("applyBulk keeps what was done when a later call fails, so Undo still works", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
  let calls = 0;
  const api = async (_p, { body }) => {
    if (++calls === 2) throw new Error("offline");
    return { before: body.ids.map((id) => ({ id, subcategory_id: null, location_id: null })) };
  };
  const r = await applyBulk(api, ids, { subcategory_id: "s1" });
  assert.equal(r.done, 100);
  assert.equal(r.error, "offline");
  const sent = [];
  await undoBulk(async (_p, { body }) => sent.push(body), r.before, ["subcategory_id"]);
  assert.deepEqual(sent, [{ ids: ids.slice(0, 100), subcategory_id: null }]);
});

test("summary reads like a sentence", () => {
  assert.equal(summary({ subcategory_id: "s", location_id: "l" }, { subcategory: "Fantasy", location: "Bookcase 2" }, 12),
    "Set Fantasy and Bookcase 2 on 12 books");
  assert.equal(summary({ location_id: null }, {}, 1), "Set no location on 1 book");
});
