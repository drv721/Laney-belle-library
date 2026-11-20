// Every table that holds her library, in an order where each table comes
// after the tables it points to. The nightly copy saves these; a restore
// empties them in the reverse order and refills them in this order.
// A new table goes here too (test/restore.test.mjs fails until it does).
export const TABLES = [
  "statuses", "lists", "collections", "subcategories", "locations",
  "books", "shelf_items", "tags", "shelf_item_tags",
  "custom_fields", "custom_values", "change_log",
  "import_batches", "libib_rows",
];
