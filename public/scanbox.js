// A box a Bluetooth scanner types into. Scanners in keyboard mode type the
// digits, usually followed by Enter. So Enter reads the box (and never submits
// a form), and a full, valid 13-digit ISBN that arrives without Enter is read
// on its own after a short pause.

import { readScan } from "./isbn.js";

const AUTO_SCAN_MS = 250; // a scanner types a whole barcode well inside this

export function attachScanBox(input, onScan) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    const raw = input.value;
    const read = readScan(raw);
    if (read.kind !== "partial") input.value = "";
    onScan(read, raw);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      fire();
    }
  });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits.length >= 13 && readScan(digits).kind === "isbn") timer = setTimeout(fire, AUTO_SCAN_MS);
  });
}
