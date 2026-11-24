import test from "node:test";
import assert from "node:assert/strict";
import { readJpeg, checkPicture, OWN_PICTURE, pictureUrl, PICTURE_BYTES_MAX } from "../src/pictures.js";
import { isCoverUrl } from "../src/covers.js";
import { readPicturesFile, resultLine } from "../public/pictures.js";
import { spineSize } from "../public/cases.js";

// A tiny stand-in JPEG: the right start and end bytes around filler.
const jpeg = (n = 200) => {
  const b = new Uint8Array(n).fill(7);
  b.set([0xff, 0xd8, 0xff], 0);
  b.set([0xff, 0xd9], n - 2);
  return Buffer.from(b).toString("base64");
};

test("only a real-looking JPEG of a sane size is kept", () => {
  assert.ok(readJpeg(jpeg()));
  assert.ok(readJpeg(`data:image/jpeg;base64,${jpeg()}`));
  assert.equal(readJpeg(Buffer.from("not a picture at all, not even close to one".repeat(5)).toString("base64")), null);
  assert.equal(readJpeg(jpeg(50)), null); // too small to be a picture
  assert.equal(readJpeg(jpeg(PICTURE_BYTES_MAX + 10)), null);
  assert.equal(readJpeg("%%%"), null);
  assert.equal(readJpeg(null), null);
});

test("each picture names its copy, its kind and a spine's shape", () => {
  assert.ok(checkPicture({ id: "abc-1", kind: "spine", ratio: 0.12, tall: 0.8, jpeg: jpeg() }).bytes);
  assert.ok(checkPicture({ id: "abc-1", kind: "cover", jpeg: jpeg() }).bytes);
  assert.match(checkPicture({ id: "abc-1", kind: "back", jpeg: jpeg() }).error, /spine or a cover/);
  assert.match(checkPicture({ id: "../x", kind: "cover", jpeg: jpeg() }).error, /name the book/);
  assert.match(checkPicture({ id: "a", kind: "spine", jpeg: jpeg() }).error, /shape/);
  assert.match(checkPicture({ id: "a", kind: "spine", ratio: 0.1, tall: 3, jpeg: jpeg() }).error, /height/);
  assert.match(checkPicture({ id: "a", kind: "cover", jpeg: "nope" }).error, /JPEG/);
});

test("a cover photo's own address counts as a cover", () => {
  const url = pictureUrl("cover", "1f0c-22", 1732480000000);
  assert.ok(OWN_PICTURE.test(url));
  assert.ok(isCoverUrl(url));
  assert.ok(isCoverUrl("https://covers.openlibrary.org/b/id/123-M.jpg"));
  assert.equal(isCoverUrl("https://example.com/x.jpg"), false);
  assert.equal(isCoverUrl("/api/pictures/cover/x.jpg"), false); // no version
});

test("the pictures file is checked before anything is sent", () => {
  assert.match(readPicturesFile("{").error, /isn't a pictures file/);
  assert.match(readPicturesFile(JSON.stringify({ pictures: [] })).error, /isn't a pictures file/);
  assert.match(readPicturesFile(JSON.stringify({ kind: "library-pictures", pictures: [] })).error, /no pictures/);
  assert.equal(readPicturesFile(JSON.stringify({ kind: "library-pictures", pictures: [{}] })).pictures.length, 1);
  assert.equal(resultLine(28, 0), "Added 28 pictures.");
  assert.equal(resultLine(1, 1), "Added 1 picture. 1 picture named a book that isn't in the library now, so it was skipped.");
});

test("a spine picture stands to scale", () => {
  const s = spineSize({ id: "1", spine_url: "/api/pictures/spine/1.jpg?v=1", spine_ratio: 0.1, spine_tall: 0.9 });
  assert.equal(s.picture, true);
  assert.equal(s.height, 90);
  assert.equal(s.width, Math.round(124 * 0.9 * 0.1));
  assert.equal(spineSize({ id: "1" }).picture, false);
  assert.equal(spineSize({ id: "1", spine_url: "/x", spine_ratio: 5, spine_tall: 1 }).width, 80); // capped
});
