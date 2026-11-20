import test from "node:test";
import assert from "node:assert/strict";
import { parseTags, sameTags, suggestions, SUGGEST_MAX } from "../public/tags.js";
import { cleanTags, TAGS_PER_BOOK } from "../src/tags.js";
import { tagSummary, applyTagBulk, undoTagBulk } from "../public/select.js";

test("parseTags splits on commas, squeezes spaces, drops repeats in any case", () => {
  assert.deepEqual(parseTags(" Fantasy,  signed   copy ,fantasy,, "), ["Fantasy", "signed copy"]);
  assert.deepEqual(parseTags(""), []);
  assert.deepEqual(parseTags(null), []);
});

test("sameTags notices a change of order or spelling", () => {
  assert.ok(sameTags(["a", "b"], ["a", "b"]));
  assert.ok(!sameTags(["a", "b"], ["b", "a"]));
  assert.ok(!sameTags(["Signed"], ["signed"]));
});

test("suggestions: most used first, never one the book has", () => {
  const all = [{ name: "Signed", count: 2 }, { name: "Fantasy", count: 9 }, { name: "Gift", count: 2 }];
  assert.deepEqual(suggestions(all, ["fantasy"]), ["Gift", "Signed"]);
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, count: i }));
  assert.equal(suggestions(many, []).length, SUGGEST_MAX);
});

test("server cleanTags matches the app and checks limits", () => {
  assert.deepEqual(cleanTags([" Fantasy ", "fantasy", "", "Signed  copy"]), { tags: ["Fantasy", "Signed copy"] });
  assert.ok(cleanTags("Fantasy").error);
  assert.ok(cleanTags([1]).error);
  assert.ok(cleanTags(["x".repeat(101)]).error);
  assert.ok(cleanTags(Array.from({ length: TAGS_PER_BOOK + 1 }, (_, i) => `t${i}`)).error);
  assert.deepEqual(cleanTags(Array.from({ length: TAGS_PER_BOOK }, (_, i) => `t${i}`)).tags.length, TAGS_PER_BOOK);
});

test("tagSummary says what happened, or why nothing did", () => {
  assert.equal(tagSummary("add", "Signed", 12, 12), "Added Signed to 12 books");
  assert.equal(tagSummary("remove", "Signed", 1, 3), "Took Signed off 1 book");
  assert.equal(tagSummary("add", "Signed", 0, 4), "All 4 already have Signed");
  assert.equal(tagSummary("add", "Signed", 0, 1), "That book already has Signed");
  assert.equal(tagSummary("remove", "Signed", 0, 5), "None of the 5 have Signed");
});

test("applyTagBulk sends 100 at a time and undo reverses only the changed books", async () => {
  const calls = [];
  const api = async (path, { body }) => {
    calls.push({ path, body });
    return { changed: body.ids.filter((id) => Number(id) % 2 === 0), tag: "Signed" };
  };
  const ids = Array.from({ length: 150 }, (_, i) => String(i));
  const r = await applyTagBulk(api, ids, "add", "signed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.add, "signed");
  assert.equal(r.changed.length, 75);
  assert.equal(r.tag, "Signed");
  calls.length = 0;
  await undoTagBulk(api, r.changed, "add", r.tag);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.remove, "Signed");
  assert.equal(calls[0].body.ids.length, 75);
});

test("applyTagBulk keeps what was done when a call fails", async () => {
  let n = 0;
  const api = async (_p, { body }) => {
    if (n++ === 1) throw new Error("offline");
    return { changed: body.ids, tag: "Gift" };
  };
  const r = await applyTagBulk(api, Array.from({ length: 150 }, (_, i) => String(i)), "add", "Gift");
  assert.equal(r.changed.length, 100);
  assert.equal(r.error, "offline");
});
