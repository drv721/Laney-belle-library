import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanValue, cleanName } from "../src/fields.js";
import { customFieldsHtml, readCustom, readChanges } from "../public/book.js";
import { statusNote, fieldNote, fieldsHtml } from "../public/fields.js";

const signed = { id: "f1", name: "Signed", field_type: "yesno" };
const gift = { id: "f2", name: "Gift from", field_type: "text" };
const paid = { id: "f3", name: "Paid", field_type: "number" };
const got = { id: "f4", name: "Got it", field_type: "date" };
const fields = [signed, gift, paid, got];

test("names are trimmed and squeezed", () => assert.equal(cleanName("  Gift   from "), "Gift from"));

test("values are checked for their kind of field", () => {
  assert.deepEqual(cleanValue(gift, "  Mom  "), { value: "Mom" });
  assert.deepEqual(cleanValue(gift, "   "), { value: null });
  assert.deepEqual(cleanValue(paid, "$12.50"), { value: "12.5" });
  assert.match(cleanValue(paid, "twelve").error, /Paid needs to be a number/);
  assert.deepEqual(cleanValue(got, "2024-12-25"), { value: "2024-12-25" });
  assert.match(cleanValue(got, "12/25/2024").error, /a date/);
  assert.deepEqual(cleanValue(signed, "Yes"), { value: "yes" });
  assert.deepEqual(cleanValue(signed, false), { value: "no" });
  assert.match(cleanValue(signed, "maybe").error, /yes or no/);
  assert.deepEqual(cleanValue(signed, null), { value: null });
  assert.match(cleanValue(gift, "x".repeat(1001)).error, /1000 characters/);
});

test("the book page shows a box of the right kind for each field", () => {
  const html = customFieldsHtml(fields, { f1: "yes", f2: "Mom" });
  assert.match(html, /More details/);
  assert.match(html, /<select name="cf-f1">.*value="yes" selected/s);
  assert.match(html, /name="cf-f2" value="Mom"/);
  assert.match(html, /type="date" name="cf-f4"/);
  assert.equal(customFieldsHtml([], {}), "");
});

const form = (values) => ({ elements: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])) });

test("only the fields she changed are sent, and an emptied one is cleared", () => {
  const custom = { f1: "yes", f2: "Mom" };
  assert.deepEqual(readCustom(form({ "cf-f1": "yes", "cf-f2": "Mom", "cf-f3": "", "cf-f4": "" }), fields, custom), { custom: {} });
  assert.deepEqual(readCustom(form({ "cf-f1": "", "cf-f2": " Dad ", "cf-f3": "$8", "cf-f4": "2025-01-02" }), fields, custom),
    { custom: { f1: null, f2: "Dad", f3: "8", f4: "2025-01-02" } });
  assert.match(readCustom(form({ "cf-f3": "lots" }), [paid], {}).error, /Paid needs to be a number/);
});

test("her fields ride along with the rest of the book page", () => {
  const item = { title: "Dracula", authors: [], tags: [], custom: {} };
  const f = form({ title: "Dracula", subtitle: "", authors: "", tags: "", isbn13: "", isbn10: "", pages: "", copies: "", rating: "",
    purchase_price: "", "cf-f2": "Mom" });
  for (const k of ["publisher", "publish_date", "description", "shelf_location", "condition", "purchase_place", "review", "notes",
    "began_date", "completed_date", "review_date", "purchase_date", "added_date", "status_code", "list_code", "collection_id",
    "subcategory_id", "location_id"]) f.elements[k] = { value: "" };
  assert.deepEqual(readChanges(f, item, [gift]).changes, { custom: { f2: "Mom" } });
});

test("the settings screen keeps the default status and says what each field is", () => {
  assert.match(statusNote({ count: 349, is_default: 1 }), /^349 books\. New books start here/);
  assert.equal(statusNote({ count: 1, is_default: 0 }), "1 book");
  assert.equal(fieldNote({ field_type: "yesno", count: 0 }), "Yes or no. Filled in on 0 books.");
  const html = fieldsHtml({
    statuses: [{ code: "not_begun", label: "Not begun", count: 3, is_default: 1 }, { code: "s_x", label: "Reading next", count: 0, is_default: 0 }],
    custom_fields: [],
  });
  assert.doesNotMatch(html, /data-remove="not_begun"/);
  assert.match(html, /data-remove="s_x"/);
  assert.match(html, /None yet\. Try Signed/);
});

test("a removed field that stepped aside comes back under its own name", async () => {
  const { originalName } = await import("../src/fields.js");
  assert.equal(originalName("Signed (removed 2141870c)"), "Signed");
  assert.equal(originalName("Signed (first edition)"), "Signed (first edition)");
});
