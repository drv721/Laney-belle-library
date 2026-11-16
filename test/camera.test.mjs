// Checks the vendored barcode reader (public/vendor) really reads a book's
// EAN-13 barcode, and that what it returns goes through readScan as an ISBN.
// Runs the same file iPhone Safari loads, in Node, on a barcode drawn here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readScan } from "../public/isbn.js";

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).reverse().join(""));
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// The 95 modules of an EAN-13 barcode, as "1" (bar) and "0" (space).
function ean13Modules(code) {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

function drawBarcode(code, { scale = 3, quiet = 15, height = 120 } = {}) {
  const bits = ean13Modules(code);
  const width = (bits.length + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let x = 0; x < width; x++) {
    const m = Math.floor(x / scale) - quiet;
    if (bits[m] !== "1") continue;
    for (let y = 10; y < height - 10; y++) {
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
    }
  }
  return { data, width, height };
}

let reader = null;
async function loadReader() {
  if (reader) return reader;
  const src = await readFile(new URL("../public/vendor/barcode-detector-3.2.3.js", import.meta.url), "utf8");
  const wasm = await readFile(new URL("../public/vendor/zxing_reader-3.1.6.wasm", import.meta.url));
  // The browser globals the reader looks for, in this realm so its type checks pass.
  globalThis.ImageData ??= class ImageData {
    constructor(data, width, height) { Object.assign(this, { data, width, height, colorSpace: "srgb" }); }
  };
  globalThis.DOMRectReadOnly ??= class DOMRectReadOnly {
    constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); }
  };
  const api = vm.runInThisContext(`${src}\nBarcodeDetectionAPI`);
  api.prepareZXingModule({ overrides: { wasmBinary: new Uint8Array(wasm).buffer } });
  reader = { api, ImageData: globalThis.ImageData };
  return reader;
}

test("vendored reader reads an EAN-13 book barcode", async () => {
  const { api, ImageData } = await loadReader();
  const det = new api.BarcodeDetector({ formats: ["ean_13", "upc_a"] });
  for (const isbn of ["9780980200447", "9791032305690"]) {
    const img = drawBarcode(isbn);
    const found = await det.detect(new ImageData(img.data, img.width, img.height));
    assert.equal(found.length, 1);
    assert.equal(found[0].format, "ean_13");
    assert.equal(found[0].rawValue, isbn);
    const read = readScan(found[0].rawValue);
    assert.equal(read.kind, "isbn");
    assert.equal(read.isbn13, isbn);
  }
});

test("vendored wasm matches the hash the reader expects", async () => {
  const { api } = await loadReader();
  const wasm = await readFile(new URL("../public/vendor/zxing_reader-3.1.6.wasm", import.meta.url));
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(wasm).digest("hex"), api.ZXING_WASM_SHA256);
  assert.equal(api.ZXING_WASM_VERSION, "3.1.6");
});

test("a store barcode (UPC-A) comes back as a UPC, not an ISBN", async () => {
  const { api, ImageData } = await loadReader();
  const det = new api.BarcodeDetector({ formats: ["ean_13", "upc_a"] });
  const img = drawBarcode("0036000291452"); // UPC-A 036000291452 drawn as EAN-13 with a leading 0
  const found = await det.detect(new ImageData(img.data, img.width, img.height));
  assert.equal(found.length, 1);
  assert.equal(readScan(found[0].rawValue).kind, "upc", `${found[0].format} ${found[0].rawValue}`);
});
