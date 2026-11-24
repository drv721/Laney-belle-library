// Pictures of her books: a spine picture and, where Open Library has none, a
// cover photo. They're kept in the R2 bucket the nightly copies use, under
// pictures/, away from nightly/ (the only part the nightly clean-up touches).
//
// A picture belongs to the book, so two copies of one book share it. The
// book's row says where it is: cover_url for a cover (the same field Open
// Library covers use, so every screen shows it) and spine_url for a spine,
// with the spine's shape (width over height, and how much of the row's
// height it stands) so the bookcase can draw it to scale.
//
// Pictures arrive in a file of up to a row or two at a time (Settings > Add
// pictures). Each one names the copy it's for, and is checked before it's kept.

export const PICTURES_MAX = 20; // per request; the app sends a file in parts
export const PICTURE_BYTES_MAX = 400 * 1024;
const KINDS = ["spine", "cover"];
const ID = /^[A-Za-z0-9-]{1,40}$/;

export const pictureKey = (kind, bookId) => `pictures/${kind}/${bookId}.jpg`;
export const pictureUrl = (kind, bookId, version) => `/api/pictures/${kind}/${bookId}.jpg?v=${version}`;
export const OWN_PICTURE = /^\/api\/pictures\/(spine|cover)\/([A-Za-z0-9-]{1,40})\.jpg\?v=\d{1,16}$/;

// base64 -> bytes, or null if it isn't a JPEG of a sane size.
export function readJpeg(b64) {
  if (typeof b64 !== "string" || b64.length > Math.ceil((PICTURE_BYTES_MAX * 4) / 3) + 4) return null;
  let bin;
  try {
    bin = atob(b64.replace(/^data:image\/jpeg;base64,/, ""));
  } catch {
    return null;
  }
  if (bin.length < 100 || bin.length > PICTURE_BYTES_MAX) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Every JPEG starts FF D8 FF and ends FF D9.
  const ok = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  return ok ? bytes : null;
}

const between = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

// One entry from the file, checked. Returns { error } or the clean entry.
export function checkPicture(p) {
  if (!p || typeof p !== "object") return { error: "An entry in the file isn't a picture." };
  if (!KINDS.includes(p.kind)) return { error: "A picture has to be a spine or a cover." };
  if (typeof p.id !== "string" || !ID.test(p.id)) return { error: "A picture doesn't name the book it's for." };
  if (p.kind === "spine") {
    if (!between(p.ratio, 0.02, 1.5)) return { error: "A spine picture is missing its shape." };
    if (p.tall !== undefined && p.tall !== null && !between(p.tall, 0.1, 1)) return { error: "A spine's height is off." };
  }
  const bytes = readJpeg(p.jpeg);
  if (!bytes) return { error: "A picture isn't a JPEG under 400 KB." };
  return { id: p.id, kind: p.kind, ratio: p.ratio ?? null, tall: p.tall ?? null, bytes };
}

// body: { pictures: [{ id: copy id, kind, jpeg (base64), ratio, tall }] }
// Returns { added, missing: [copy ids not found] }. A picture replaces the
// book's earlier one; the change log keeps what was there before.
export async function addPictures(env, by, body) {
  const list = body?.pictures;
  if (!Array.isArray(list) || !list.length) return { status: 400, data: { error: "No pictures in that file." } };
  if (list.length > PICTURES_MAX) return { status: 400, data: { error: `Send ${PICTURES_MAX} pictures at most at a time.` } };
  const clean = [];
  for (const p of list) {
    const c = checkPicture(p);
    if (c.error) return { status: 400, data: { error: c.error } };
    clean.push(c);
  }
  const ids = [...new Set(clean.map((c) => c.id))];
  const { results } = await env.DB.prepare(
    `SELECT s.id AS copy_id, b.id AS book_id, b.cover_url, b.spine_url, b.spine_ratio, b.spine_tall
       FROM shelf_items s JOIN books b ON b.id = s.book_id
      WHERE s.deleted_at IS NULL AND s.id IN (${ids.map(() => "?").join(",")})`
  ).bind(...ids).all();
  const byCopy = new Map(results.map((r) => [r.copy_id, r]));
  const missing = [];
  const stmts = [];
  const stamp = new Date().toISOString();
  const version = Date.now();
  for (const c of clean) {
    const row = byCopy.get(c.id);
    if (!row) { missing.push(c.id); continue; }
    await env.BACKUPS.put(pictureKey(c.kind, row.book_id), c.bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const url = pictureUrl(c.kind, row.book_id, version);
    const before = c.kind === "cover"
      ? { cover_url: row.cover_url }
      : { spine_url: row.spine_url, spine_ratio: row.spine_ratio, spine_tall: row.spine_tall };
    const after = c.kind === "cover" ? { cover_url: url } : { spine_url: url, spine_ratio: c.ratio, spine_tall: c.tall };
    stmts.push(
      c.kind === "cover"
        ? env.DB.prepare("UPDATE books SET cover_url = ?, updated_at = ? WHERE id = ?").bind(url, stamp, row.book_id)
        : env.DB.prepare("UPDATE books SET spine_url = ?, spine_ratio = ?, spine_tall = ?, updated_at = ? WHERE id = ?")
            .bind(url, c.ratio, c.tall, stamp, row.book_id),
      env.DB.prepare(
        `INSERT INTO change_log (by_email, entity, entity_id, action, before_json, after_json) VALUES (?, 'book', ?, ?, ?, ?)`
      ).bind(by, row.book_id, `picture_${c.kind}`, JSON.stringify(before), JSON.stringify(after)),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { status: 200, data: { added: clean.length - missing.length, missing } };
}

// GET /api/pictures/{kind}/{book id}.jpg
export async function getPicture(env, kind, bookId) {
  if (!KINDS.includes(kind) || !ID.test(bookId)) return new Response("Not found", { status: 404 });
  const obj = await env.BACKUPS.get(pictureKey(kind, bookId));
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": "image/jpeg",
      // The address changes with each new picture (?v=), so it can be kept a long time.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
