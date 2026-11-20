// Tags: her own labels, as many as she likes on a book. A tag exists while
// at least one book has it; the menus only list tags that are in use, so a
// tag taken off its last book simply drops out of them.
//
// Names match without regard to case: typing "fantasy" on a book uses the
// existing "Fantasy" tag rather than making a second one.

import { BULK_MAX } from "./sections.js";

export const TAG_MAX_LENGTH = 100;
export const TAGS_PER_BOOK = 30;

const newId = () => crypto.randomUUID();

// One tag name, cleaned: spaces trimmed and squeezed. "" when nothing is left.
export function cleanTag(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

// A book's whole tag list from the app. Returns { tags } or { error }.
// Repeats (in any case) are dropped and the first spelling is kept.
export function cleanTags(input) {
  if (!Array.isArray(input) || !input.every((t) => typeof t === "string")) {
    return { error: "Tags need to be a list of names." };
  }
  const seen = new Set();
  const tags = [];
  for (const raw of input) {
    const t = cleanTag(raw);
    if (!t) continue;
    if (t.length > TAG_MAX_LENGTH) return { error: `A tag can be ${TAG_MAX_LENGTH} characters at most.` };
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  if (tags.length > TAGS_PER_BOOK) return { error: `A book can have ${TAGS_PER_BOOK} tags at most.` };
  return { tags };
}

// Statements that make one book's tags exactly this list.
export function setTagStatements(env, itemId, tags) {
  const stmts = [env.DB.prepare("DELETE FROM shelf_item_tags WHERE shelf_item_id = ?").bind(itemId)];
  for (const name of tags) stmts.push(...addTagStatements(env, name, [itemId]));
  return stmts;
}

// Statements that put one tag on these books (books that have it already are left alone).
function addTagStatements(env, name, ids) {
  return [
    env.DB.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").bind(newId(), name),
    env.DB.prepare(
      `INSERT OR IGNORE INTO shelf_item_tags (shelf_item_id, tag_id)
       SELECT j.value, t.id FROM json_each(?) j, tags t WHERE t.name = ? COLLATE NOCASE`
    ).bind(JSON.stringify(ids), name),
  ];
}

// POST /api/books/tags { ids, add } or { ids, remove }: one tag on or off
// many books at once. Answers with the books that actually changed, so Undo
// touches only those.
export async function bulkTag(env, by, body) {
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id))) {
    return { status: 400, data: { error: "Pick at least one book." } };
  }
  if (ids.length > BULK_MAX) return { status: 400, data: { error: `${BULK_MAX} books at a time at most.` } };
  const adding = "add" in body;
  const removing = "remove" in body;
  if (adding === removing) return { status: 400, data: { error: "Say whether to add or remove the tag." } };
  const name = cleanTag(adding ? body.add : body.remove);
  if (!name) return { status: 400, data: { error: "Type a tag first." } };
  if (name.length > TAG_MAX_LENGTH) return { status: 400, data: { error: `A tag can be ${TAG_MAX_LENGTH} characters at most.` } };

  const list = JSON.stringify(ids);
  const { results: books } = await env.DB.prepare(
    `SELECT s.id, s.deleted_at,
            EXISTS (SELECT 1 FROM shelf_item_tags st JOIN tags t ON t.id = st.tag_id
                     WHERE st.shelf_item_id = s.id AND t.name = ? COLLATE NOCASE) AS has_tag,
            (SELECT COUNT(*) FROM shelf_item_tags st WHERE st.shelf_item_id = s.id) AS tag_count
       FROM shelf_items s WHERE s.id IN (SELECT value FROM json_each(?))`
  ).bind(name, list).all();
  if (books.length !== new Set(ids).size) return { status: 404, data: { error: "Some of those books aren't in the library." } };
  if (books.some((b) => b.deleted_at)) {
    return { status: 409, data: { error: "Some of those books were removed. Refresh and try again." } };
  }
  const changed = books.filter((b) => (adding ? !b.has_tag : b.has_tag)).map((b) => b.id);
  if (adding) {
    const full = books.filter((b) => !b.has_tag && b.tag_count >= TAGS_PER_BOOK);
    if (full.length) {
      return { status: 400, data: { error: `${full.length} of those books already have ${TAGS_PER_BOOK} tags, the most a book can have.` } };
    }
  }
  // The stored spelling, so the toast and Undo use the tag's real name.
  const storedName = async () =>
    (await env.DB.prepare("SELECT name FROM tags WHERE name = ? COLLATE NOCASE").bind(name).first())?.name ?? name;
  if (!changed.length) return { status: 200, data: { changed: [], tag: await storedName() } };

  const changedList = JSON.stringify(changed);
  const stamp = new Date().toISOString();
  const stmts = [
    // One change-log row per book, so each book's history shows the tag.
    env.DB.prepare(
      `INSERT INTO change_log (by_email, entity, entity_id, action, before_json, after_json)
       SELECT ?, 'shelf_item', value, ?, NULL, json_object('tag', ?) FROM json_each(?)`
    ).bind(by, adding ? "bulk_tag_add" : "bulk_tag_remove", name, changedList),
    ...(adding
      ? addTagStatements(env, name, changed)
      : [
          env.DB.prepare(
            `DELETE FROM shelf_item_tags
              WHERE shelf_item_id IN (SELECT value FROM json_each(?))
                AND tag_id IN (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)`
          ).bind(changedList, name),
        ]),
    env.DB.prepare(
      "UPDATE shelf_items SET updated_at = ?, updated_by = ? WHERE id IN (SELECT value FROM json_each(?))"
    ).bind(stamp, by, changedList),
  ];
  await env.DB.batch(stmts);
  return { status: 200, data: { changed, tag: await storedName() } };
}
