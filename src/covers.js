// Cover art from Open Library.
//
// Their rules, from openlibrary.org/developers/api and /dev/docs/api/covers:
// - Ask for many books in one request, never hundreds of single-book requests.
// - Unidentified requests get 1 a second; a User-Agent with a contact gets 3.
// - Cover images looked up by ISBN are limited to 100 per 5 minutes per IP,
//   but images by cover ID are not, so we store the by-ID address.
// - Images must load from covers.openlibrary.org, and a link back is appreciated
//   (it's in the app's footer).
//
// The app paces its calls (one batch a second), so this file only does one batch.

export const MAX_ISBNS_PER_CALL = 25;
const COVER_URL = /^https:\/\/covers\.openlibrary\.org\/b\/id\/(\d+)-[SML]\.jpg$/;

export function isCoverUrl(v) {
  return typeof v === "string" && /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-M\.jpg$/.test(v);
}

function userAgent(env) {
  // Set OL_CONTACT (an email) as a var if you want Open Library's higher limit.
  return env.OL_CONTACT ? `MelanieLibrary/1.0 (${env.OL_CONTACT})` : "MelanieLibrary/1.0";
}

// isbns: up to 25 ISBN-13s. Returns { isbn13: medium cover URL } for the ones found.
export async function lookupCovers(env, isbns) {
  const clean = [...new Set(isbns.filter((i) => /^\d{13}$/.test(i)))].slice(0, MAX_ISBNS_PER_CALL);
  if (!clean.length) return {};
  const url =
    "https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=" +
    clean.map((i) => `ISBN:${i}`).join(",");
  const res = await fetch(url, { headers: { "User-Agent": userAgent(env), Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const isbn of clean) {
    const cover = data[`ISBN:${isbn}`]?.cover;
    const any = cover?.medium || cover?.large || cover?.small;
    const m = typeof any === "string" && any.match(COVER_URL);
    if (m) out[isbn] = `https://covers.openlibrary.org/b/id/${m[1]}-M.jpg`;
  }
  return out;
}

// One book's details by ISBN-13, for scan-to-add. Returns null when Open
// Library doesn't have it. Field names are from openlibrary.org/dev/docs/api/books
// (jscmd=data): title, subtitle, authors[].name, publishers[].name,
// publish_date, number_of_pages, cover.{small,medium,large}.
export async function lookupBook(env, isbn13) {
  if (!/^\d{13}$/.test(isbn13)) return null;
  const url = `https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=ISBN:${isbn13}`;
  const res = await fetch(url, { headers: { "User-Agent": userAgent(env), Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
  const d = (await res.json())[`ISBN:${isbn13}`];
  if (!d || typeof d.title !== "string") return null;
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const names = (list) =>
    Array.isArray(list) ? list.map((a) => str(a?.name, 200)).filter(Boolean).slice(0, 20) : [];
  const any = d.cover?.medium || d.cover?.large || d.cover?.small;
  const m = typeof any === "string" && any.match(COVER_URL);
  return {
    title: str(d.title, 500),
    subtitle: str(d.subtitle, 500),
    authors: names(d.authors),
    publisher: names(d.publishers)[0] ?? null,
    publish_date: str(d.publish_date, 40),
    pages: Number.isInteger(d.number_of_pages) && d.number_of_pages > 0 ? d.number_of_pages : null,
    cover_url: m ? `https://covers.openlibrary.org/b/id/${m[1]}-M.jpg` : null,
  };
}
