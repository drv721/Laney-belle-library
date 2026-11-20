// GET /api/stats: counts across the library, for the Stats screen.
//
// Every count is of books on her list (what the library screen counts), not
// copies, except the copies total itself. Removed books never count. A removed
// subcategory or location counts as not set, the same as the library list.
// Months come back as "YYYY-MM" from the dates saved on each book; the app
// works out "this month" and "this year" on her own clock.

const LIVE = "s.deleted_at IS NULL";
const SUB = "LEFT JOIN subcategories sc ON sc.id = s.subcategory_id AND sc.deleted_at IS NULL";
const LOC = "LEFT JOIN locations lo ON lo.id = s.location_id AND lo.deleted_at IS NULL";

export const TOP_MAX = 10; // tags and authors shown

export async function libraryStats(env) {
  const q = (sql) => env.DB.prepare(sql);
  const [totals, statuses, lists, collections, locations, subcategories, unset, tags, authors, authorCount, added, finished] =
    await env.DB.batch([
      q(`SELECT COUNT(*) AS books, COALESCE(SUM(s.copies), 0) AS copies,
                COALESCE(SUM(b.pages), 0) AS pages, COUNT(b.pages) AS with_pages
           FROM shelf_items s JOIN books b ON b.id = s.book_id WHERE ${LIVE}`),
      q(`SELECT st.code AS id, st.label AS name, COUNT(s.id) AS count
           FROM statuses st LEFT JOIN shelf_items s ON s.status_code = st.code AND ${LIVE}
          WHERE st.deleted_at IS NULL
          GROUP BY st.code ORDER BY st.sort_order`),
      q(`SELECT l.code AS id, l.label AS name, COUNT(s.id) AS count
           FROM lists l LEFT JOIN shelf_items s ON s.list_code = l.code AND ${LIVE}
          GROUP BY l.code ORDER BY l.sort_order`),
      q(`SELECT c.id, c.name, COUNT(s.id) AS count
           FROM collections c LEFT JOIN shelf_items s ON s.collection_id = c.id AND ${LIVE}
          GROUP BY c.id ORDER BY c.sort_order`),
      // Every location and subcategory she has, even with no books yet, then "Not set yet".
      q(`SELECT lo.id, lo.name, COUNT(s.id) AS count
           FROM locations lo LEFT JOIN shelf_items s ON s.location_id = lo.id AND ${LIVE}
          WHERE lo.deleted_at IS NULL GROUP BY lo.id ORDER BY lo.sort_order, lo.name COLLATE NOCASE`),
      q(`SELECT sc.id, sc.name, sc.collection_id, COUNT(s.id) AS count
           FROM subcategories sc LEFT JOIN shelf_items s ON s.subcategory_id = sc.id AND ${LIVE}
          WHERE sc.deleted_at IS NULL GROUP BY sc.id ORDER BY COUNT(s.id) DESC, sc.name COLLATE NOCASE`),
      q(`SELECT SUM(lo.id IS NULL) AS no_location, SUM(sc.id IS NULL) AS no_subcategory
           FROM shelf_items s ${LOC} ${SUB} WHERE ${LIVE}`),
      q(`SELECT t.name AS id, t.name, COUNT(*) AS count
           FROM tags t JOIN shelf_item_tags st ON st.tag_id = t.id JOIN shelf_items s ON s.id = st.shelf_item_id AND ${LIVE}
          GROUP BY t.id ORDER BY COUNT(*) DESC, t.name COLLATE NOCASE LIMIT ${TOP_MAX}`),
      q(`SELECT MIN(j.value) AS name, COUNT(*) AS count
           FROM shelf_items s JOIN books b ON b.id = s.book_id, json_each(b.authors) j
          WHERE ${LIVE} AND TRIM(j.value) <> ''
          GROUP BY LOWER(TRIM(j.value)) ORDER BY COUNT(*) DESC, MIN(j.value) COLLATE NOCASE LIMIT ${TOP_MAX}`),
      q(`SELECT COUNT(DISTINCT LOWER(TRIM(j.value))) AS n
           FROM shelf_items s JOIN books b ON b.id = s.book_id, json_each(b.authors) j
          WHERE ${LIVE} AND TRIM(j.value) <> ''`),
      q(`SELECT substr(s.added_date, 1, 7) AS month, COUNT(*) AS count
           FROM shelf_items s WHERE ${LIVE} AND s.added_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*'
          GROUP BY month ORDER BY month DESC`),
      q(`SELECT substr(s.completed_date, 1, 7) AS month, COUNT(*) AS count
           FROM shelf_items s WHERE ${LIVE} AND s.completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]*'
          GROUP BY month ORDER BY month DESC`),
    ]);
  const t = totals.results[0];
  return {
    books: t.books,
    copies: t.copies,
    pages: t.pages,
    with_pages: t.with_pages,
    authors: authorCount.results[0].n,
    statuses: statuses.results,
    lists: lists.results,
    collections: collections.results,
    locations: [...locations.results, { id: "none", name: null, count: unset.results[0].no_location ?? 0 }],
    subcategories: [...subcategories.results, { id: "none", name: null, count: unset.results[0].no_subcategory ?? 0 }],
    tags: tags.results,
    top_authors: authors.results,
    added_by_month: added.results,
    finished_by_month: finished.results,
  };
}
