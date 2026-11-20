import test from "node:test";
import assert from "node:assert/strict";
import { spotLine, spotDetails, countLine, whereHeading, isScanKey, RESULTS_MAX } from "../public/hub.js";

test("spotLine shows location and shelf, or nothing", () => {
  assert.equal(spotLine({ location: "Bookcase 3", shelf_location: "Top shelf" }), "Bookcase 3 · Top shelf");
  assert.equal(spotLine({ location: "Bookcase 3", shelf_location: null }), "Bookcase 3");
  assert.equal(spotLine({}), "");
});

test("spotDetails leaves out what isn't set, and uses her labels", () => {
  const d = spotDetails({ shelf_location: "Left", subcategory: null, status_code: "reading", list_code: "owned" },
    (c) => (c === "reading" ? "Reading" : c), (c) => (c === "owned" ? "My books" : c));
  assert.deepEqual(d, [["Shelf", "Left"], ["Status", "Reading"], ["List", "My books"]]);
});

test("countLine covers newest, none, some and too many", () => {
  assert.equal(countLine("", 355), "Newest added");
  assert.match(countLine("", 0), /No books yet/);
  assert.match(countLine("oz", 0), /No books match/);
  assert.equal(countLine("oz", 1), "1 book matches");
  assert.equal(countLine("oz", 16), "16 books match");
  assert.match(countLine("a", RESULTS_MAX + 5), new RegExp(`Showing ${RESULTS_MAX} of ${RESULTS_MAX + 5}`));
});

test("whereHeading only speaks after a scan", () => {
  assert.equal(whereHeading([{}], false), "");
  assert.equal(whereHeading([{}], true), "You have this one");
  assert.equal(whereHeading([{}, {}], true), "You have 2 copies");
});

test("isScanKey takes digits, X and Enter, never shortcuts", () => {
  assert.ok(isScanKey({ key: "9" }));
  assert.ok(isScanKey({ key: "X" }));
  assert.ok(isScanKey({ key: "Enter" }));
  assert.ok(!isScanKey({ key: "a" }));
  assert.ok(!isScanKey({ key: "Tab" }));
  assert.ok(!isScanKey({ key: "9", metaKey: true }));
});
