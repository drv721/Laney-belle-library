import test from "node:test";
import assert from "node:assert/strict";
import { periodCounts, headline, groupRows, statsHtml } from "../public/stats.js";

test("periodCounts uses her clock's month and year", () => {
  const by = [{ month: "2026-11", count: 5 }, { month: "2026-02", count: 3 }, { month: "2025-11", count: 9 }];
  assert.deepEqual(periodCounts(by, new Date(2026, 10, 20)), { thisMonth: 5, thisYear: 8 });
  assert.deepEqual(periodCounts(by, new Date(2027, 0, 1)), { thisMonth: 0, thisYear: 0 });
  assert.deepEqual(periodCounts([], new Date()), { thisMonth: 0, thisYear: 0 });
});

test("headline shows copies and pages only when they add something", () => {
  assert.deepEqual(headline({ books: 10, authors: 4, copies: 10, pages: 0, with_pages: 0 }), [["Books", "10"], ["Authors", "4"]]);
  assert.deepEqual(headline({ books: 355, authors: 291, copies: 369, pages: 84847, with_pages: 260 }),
    [["Books", "355"], ["Authors", "291"], ["Copies", "369"], ["Pages", "84,847"]]);
});

test("groupRows keeps empty bookcases when asked, drops an empty Not set yet", () => {
  const locs = [{ id: "a", name: "Bookcase 1", count: 3 }, { id: "b", name: "Bookcase 2", count: 0 }, { id: "none", name: null, count: 0 }];
  assert.deepEqual(groupRows(locs, { keepEmpty: true }).map((r) => r.label), ["Bookcase 1", "Bookcase 2"]);
  assert.deepEqual(groupRows(locs).map((r) => r.label), ["Bookcase 1"]);
  assert.equal(groupRows([{ id: "none", name: null, count: 4 }])[0].label, "Not set yet");
});

test("statsHtml escapes names and links rows to the library menus", () => {
  const s = {
    books: 2, copies: 2, authors: 1, pages: 0, with_pages: 0,
    statuses: [{ id: "not_begun", name: "Not begun", count: 2 }], lists: [{ id: "owned", name: "Owned", count: 2 }],
    collections: [{ id: "default", name: "Library", count: 2 }], locations: [{ id: "none", name: null, count: 2 }],
    subcategories: [{ id: "x", name: "<b>Gothic</b>", collection_id: "default", count: 1 }, { id: "none", name: null, count: 1 }],
    tags: [], top_authors: [{ name: "Bram Stoker", count: 2 }], added_by_month: [], finished_by_month: [],
  };
  const html = statsHtml(s, new Date(2026, 10, 20));
  assert.ok(html.includes("&lt;b&gt;Gothic&lt;/b&gt;"));
  assert.ok(html.includes('data-filter="location" data-value="none"'));
  assert.ok(html.includes('data-filter="q" data-value="Bram Stoker"'));
  assert.ok(!html.includes("Collection</h3>"), "one collection: no Collection group");
  assert.ok(!html.includes("Most used tags"), "no tags yet: no tag group");
});

test("share never says 0% for a book that's there", async () => {
  const { share } = await import("../public/stats.js");
  assert.equal(share(1, 355), "under 1%");
  assert.equal(share(353, 355), "99%");
  assert.equal(share(355, 355), "100%");
});
