// ISBN checks shared by the add screen, the Libib import and the Worker.

export function isbn13Valid(d) {
  if (!/^\d{13}$/.test(d)) return false;
  const sum = [...d].reduce((a, ch, i) => a + Number(ch) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}

export function isbn10Valid(d) {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  const sum = [...d].reduce((a, ch, i) => a + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
  return sum % 11 === 0;
}

export function isbn10To13(d) {
  const base = "978" + d.slice(0, 9);
  const sum = [...base].reduce((a, ch, i) => a + Number(ch) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

// Only 978 ISBN-13s have an ISBN-10.
export function isbn13To10(d) {
  if (!isbn13Valid(d) || !d.startsWith("978")) return null;
  const core = d.slice(3, 12);
  const sum = [...core].reduce((a, ch, i) => a + Number(ch) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}

// What a scanner or a person typed, read as a book barcode.
// Returns { kind, isbn13, isbn10, message }:
//   kind "isbn"    a valid ISBN (13 or 10); isbn13 is always filled
//   kind "upc"     a 12-digit UPC, which is a price code, not the ISBN
//   kind "partial" still being typed
//   kind "bad"     wrong length or a failed check digit
export function readScan(raw) {
  const s = String(raw ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  // A barcode with its 2 or 5 digit price add-on comes through as 15 or 18 digits.
  const digits = /^97[89]\d{12}(\d{3})?$/.test(s) && (s.length === 15 || s.length === 18) ? s.slice(0, 13) : s;
  if (digits.length === 13) {
    if (isbn13Valid(digits) && /^97[89]/.test(digits)) return { kind: "isbn", isbn13: digits, isbn10: isbn13To10(digits) };
    return { kind: "bad", message: "That number isn't a valid ISBN. Check it and try again." };
  }
  if (digits.length === 10) {
    if (isbn10Valid(digits)) return { kind: "isbn", isbn13: isbn10To13(digits), isbn10: digits };
    return { kind: "bad", message: "That number isn't a valid ISBN. Check it and try again." };
  }
  if (digits.length === 12 && !digits.includes("X")) {
    return { kind: "upc", message: "That's a store barcode, not the ISBN. Look for the barcode that starts with 978, often inside the front cover, or type the ISBN." };
  }
  if (digits.length < 13) return { kind: "partial" };
  return { kind: "bad", message: "That's too long for an ISBN. Check it and try again." };
}
