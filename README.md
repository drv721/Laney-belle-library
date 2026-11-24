# Melanie's library

A home-screen web app for her books. One Cloudflare Worker serves the app and its API, her library lives in a D1 database, and a copy goes to R2 every night (the last 30 are kept). Cloudflare Access decides who can open it: only Daniel and Melanie.

## What's in weekend 1

- `migrations/0001_initial.sql`: every table the Christmas plan needs. Books, her copies, statuses, lists (owned, wish list, borrowed, previously owned), collections, tags, custom fields, a change log, and import tables that keep every original Libib row.
- `src/index.js`: the API. Add, edit, remove (hidden, never erased), restore, search, filter, sort, rename a status, export a spreadsheet. Every change is written to the change log. It checks the Access sign-in on every request and only lets the two allowed emails in.
- `src/backup.js`: the nightly copy to R2, deleting anything older than the newest 30.
- `public/`: the app itself, dark theme, list or cover view, add a book by hand, tap a status to change it, remove with undo, a Recently removed view, and the Libib import. Settings (top bar) holds Subcategories and locations, Recently removed, Import from Libib and Export spreadsheet.

Statuses start as Libib's four: Not begun, In progress, Completed, Abandoned. Books store a fixed code, so renaming a status never touches a book.

## Importing from Libib (weekend 2, built early)

- In Libib, export each collection as a spreadsheet. Libib makes one file per collection.
- In the app, tap Settings, then Import from Libib, and pick one or more files. The phone or iPad reads them; nothing is saved yet.
- Each file gets a list (owned, wish list, borrowed, previously owned; guessed from the file name) and a collection name.
- Every row shows with its cover and anything worth a look: duplicates inside a file, across files, or already in the library, and values that didn't fit (kept as written, never guessed).
- Duplicates are only skipped when she unticks them, or taps Skip duplicates and checks the result.
- Import saves 50 books at a time. Every original row is kept in `libib_rows`. Past imports can each be undone, which moves their books to Recently removed.
- Libib's "group" column goes in as a tag for now.
- Mapping checked against a real Libib export (Nov 2026): `length` is pages, `began` and `completed` are reading dates, several authors sit in one cell as "First Last, First Last" (a PhD or Jr. stays with its name), and an ISBN-10 found in the ISBN-13 column is used. Author cells that look jumbled in Libib are flagged to check after import.
- "Might be the same book" flags the same title where one copy has no ISBN or no author. Skip duplicates leaves these for her to decide.
- Files: `public/libib-map.js` (reads the file), `public/import.js` (the screen), `src/import.js` (saving and undo), `src/covers.js` (covers). Tests: `npm test`.

Covers come from Open Library, about one request a second, 25 books per request, stored by cover ID (their rules allow that without the ISBN limit). A book added by hand with an ISBN gets its cover the same way. Optional: add `"OL_CONTACT": "an email"` under `vars` in `wrangler.jsonc` for Open Library's higher limit.

No database change is needed for this, so no migration runs. Pull, then `npx wrangler deploy`.

## Book page

- Tap any book in the list (or its cover in Covers view) to open its page. Every detail is there: title, subtitle, authors (one per line), ISBNs, publisher, published, pages, description, status, list, collection, copies, shelf location, condition, added, reading dates, rating, review, notes and purchase details.
- Save sends only what changed, through `PATCH /api/books/{id}`, so the change log shows exactly what moved. Enter in a box never saves; only the Save button does.
- ISBNs are checked before saving. A valid ISBN-10 fills in an empty ISBN-13 and the other way round.
- Find cover looks the ISBN up on Open Library and saves the cover. Add an ISBN first for a book that has none.
- Book details (title, authors, ISBN...) are shared by every copy of the same book, so fixing one fixes both. Shelf details belong to that copy.
- Remove on the page works like Remove on the row, with Undo.
- The server refuses an empty title, a cover from anywhere but Open Library, and copies below 1.
- Files: `public/book.js`, tests in `test/book.test.mjs`.

## Sort, filter, subcategories and locations

- **Sort and filter** sits under the status chips and folds away on a phone; its label says what's in use. Sort by title, author (by last name, so Le Guin files under L), newest added, status, subcategory or location. The sort is remembered on each device.
- Filter by list, collection, subcategory, location and tag. A menu with nothing to choose stays hidden (one collection, no tags yet). Subcategory and Location also offer **Not set yet**, to find the books still to sort.
- **Subcategories** are hers to name (Classics, Fiction, Fantasy, Work...). Each collection has its own, and a book sits in one subcategory or none. Moving a book to another collection drops a subcategory that doesn't belong there.
- **Locations** start as stand-ins, Bookcase 1 to Bookcase 6, to rename once the real names are known. Location is the menu; the free-text **Shelf** box is still there for "top shelf, left".
- Both are set on the book page and in Add a book, and managed on **Subcategories and locations** (in Settings, at the top): add, rename, or remove. A new name changes on every book at once. Remove has Undo, and an undone one comes back with every book that was in it (removing only hides it).
- The export spreadsheet has subcategory and location columns.
- **Select** (beside the book count) sets a subcategory and a location on many books at once. Tap books to tick them, or Select all to tick everything the list shows. Pick a subcategory, a location or both in the bar at the bottom ("Leave as is" keeps what each book has), then Set. Undo puts every book back as it was. Only books on screen stay ticked, so a change never reaches a book she can't see. A good way to sort the library: filter Subcategory to Not set yet, search an author or series, Select all, Set.
- **Tags**: type them on the book page or in Add a book, with commas between. The tags she already uses show underneath; a tap adds one, so a tag isn't typed three ways. Names match without regard to case ("fantasy" uses the existing "Fantasy"). In Select, type a tag and tap Add tag or Take off to change many books at once, with Undo. A tag on no book drops out of the menus.
- **Library hub** (Settings, then Library hub on this device) turns a device into a find and scan screen for the shelves, meant for the iPad. Type a title or author and the covers show with each book's spot; tap one to see where it is, with Open book page for the rest. Scan a book with the Inateck scanner (no tap first) or Scan with camera: a book she has shows where it is, a book she doesn't have opens Add a book with its details looked up. After 3 quiet minutes the screen clears itself. It stays on for that device only, until Full library. Adding `?hub` to the end of the app's address turns it on too, for a Home Screen bookmark.
- **Library stats** (Settings, then Library stats) counts the library: books, authors, copies and pages, books added this month and this year, books finished this year, then rows by status, list, location, subcategory, most used tags and the authors with the most books. Every location and subcategory she has shows, even at 0, plus Not set yet. Tap a row to see those books in the library with that menu set; an author's row searches for the name. Removed books never count.
- Books from different collections can share a location, but a subcategory can only be set on books from one collection.
- Saves through `POST /api/books/bulk`, 100 books per call, with one change-log row per book. Files: `bulkSet` in `src/sections.js`, `public/select.js`. Tests: `test/select.test.mjs`.
- Files: `migrations/0002_subcategories_locations.sql`, `src/sections.js` (API), `src/sort.js` (author sort), `public/sections.js` (the screen), menus in `public/app.js`, `public/book.js`, `public/add.js`. Tests: `test/sort.test.mjs`, `test/book.test.mjs`.

This one changes the database: two new tables and two new columns on her copies, nothing renamed or removed. Pull, add them to the live database, then deploy:

```
cd ~/Code/Laney-belle-library && git pull
npx wrangler d1 migrations apply melanie-library --remote
npx wrangler deploy
```

The nightly R2 copy is there if anything goes wrong; the migration only adds.

## Scan to add

- Tap Add book. The ISBN box at the top has the cursor, so a Bluetooth scanner in keyboard mode types straight into it. Typing an ISBN (10 or 13 digits) and pressing Enter does the same.
- The app looks the book up on Open Library and fills in the title, author and cover for her to check, then Save. Save and scan next keeps the dialog open and keeps the status, list and shelf she picked.
- A book that's already in the library shows which copy is there. Save still adds another copy if she means to.
- A 12-digit store barcode (UPC, on many mass-market paperbacks) gets a note to scan or type the ISBN instead. A barcode with a price add-on is trimmed to the ISBN.
- A book Open Library doesn't have keeps its ISBN and waits for her to type the title.
- **Bulk scan** (button at the top) is for a pile. She picks the list, status and shelf once, then scans book after book with no interruptions. Each scan is only looked up (one a second, Open Library's pace), never saved. Done scanning shows the whole pile with what needs a look: already in the library, scanned twice, or not found (she types the title right in the list). Duplicates stay ticked unless she unticks them or taps Skip duplicates, the same as the Libib import. Add saves the ticked ones, and Undo all puts them in Recently removed.
- The pile is kept in the device's storage until it's added, so a reload, the iPad sleeping or leaving the screen doesn't lose scans. Remove takes off a mis-scan; Start over clears the pile.
- Files: `public/add.js` (the dialog), `public/bulk.js` (bulk scan), `public/scanbox.js` (scanner input), `public/isbn.js` (ISBN checks, shared with the import), `src/covers.js` (`lookupBook`), route `GET /api/lookup?isbn=` in `src/index.js` (saves nothing). Tests: `npm test`.

No database change, so no migration. Pull, then `npx wrangler deploy`.

## Camera scanning

- **Use camera** sits under the scan box in Add a book and in Bulk scan. It opens the back camera and reads the barcode on the book, then hands the number to the same code the scanner uses, so lookups, duplicate warnings and the review work the same way.
- In Add a book the camera closes after one book. If she used it, Save and scan next opens it again for the next book. In Bulk scan it stays open and beeps for each book; holding the same book in view doesn't add it twice. Done scanning, Back to library and closing the dialog turn the camera off, and so does switching away from the app.
- A store barcode (UPC, or any non-book barcode) gets the same "that's a store barcode" note as the scanner, and the camera keeps looking.
- iPhone and iPad Safari have no built-in barcode reader, so the app carries one: `public/vendor/barcode-detector-3.2.3.js` (npm barcode-detector 3.2.3) and `public/vendor/zxing_reader-3.1.6.wasm` (npm zxing-wasm 3.1.6), both MIT, with the wasm built from zxing-cpp (Apache 2.0). Licenses are in `public/vendor/LICENSES.txt`. They load from the app itself the first time the camera opens (about 1 MB), never from another site. Browsers with their own reader, like Chrome on Android, use theirs.
- The browser asks for camera permission the first time. If it was refused, the camera box says so and the scan box still works.
- Files: `public/camera.js`. Tests: `test/camera.test.mjs` draws an ISBN barcode and reads it with the bundled reader.

No database change, so no migration. Pull, then `npx wrangler deploy`.

## Find by title (books with no barcode)

- In Add a book, type the title (and the author if she knows it) and tap **Find by title**, or press Enter (the keyboard's Search key on a phone) in Title or Author. Enter there never saves; saving takes a Save button. It searches Open Library and shows up to 8 matches with covers. **Use this** fills the title, author, subtitle and cover; Save adds it. Nothing is saved by the search itself.
- Open Library's search returns a work, not her exact edition, so only what's true of every edition comes in: title, subtitle, authors and the work's cover (marked "cover may be another edition"). Publisher, date and pages stay empty for her to type. If she changes the title after picking, the picked cover and subtitle don't ride along.
- A match already in the library says so, the same as a scan. The check is by exact title, ignoring upper and lower case.
- No match, or Open Library unreachable: she can still Save what she typed.
- Files: `searchBooks` in `src/covers.js`, route `GET /api/search?title=&author=` in `src/index.js`, the button in `public/add.js`. Test in `test/scan.test.mjs`.

No database change, so no migration. Pull, then `npx wrangler deploy`.

## Fields and statuses she adds herself

- **Settings, then Fields and statuses.** She adds, renames and removes her own statuses (like Reading next) and her own fields for the book page (like Signed, Gift from or Price paid). Each change saves right away, and Remove has Undo.
- **Statuses:** a new one goes at the end, so the status button on each book steps through it last. The four from Libib can be renamed. Not begun is where new books start, so it can't be removed. A status can only be removed when no book has it, counting books in Recently removed, so no book is ever left with a status that isn't on the menu.
- **Fields:** each is Text, Number, Date or Yes or no, picked when it's added. They show on every book page under More details and save with Save; an emptied box clears the value. A removed field keeps what she typed on every book, and Undo brings it all back. If she adds a new field with the same name as a removed one, the removed one steps aside quietly; bringing it back while the new one is still there asks her to rename one first.
- **Export** adds one column per field, after the usual columns, under the names she gave them. The nightly copy already includes both tables.
- Every add, rename, remove and value change goes in the change log with before and after.
- Files: `migrations/0003_custom_fields_statuses.sql`, `src/fields.js` (API), `public/fields.js` (the screen), the More details section in `public/book.js`. Tests: `test/fields.test.mjs`.

This one changes the database: one new column on statuses and on custom fields, and an index, nothing renamed or removed. Run the migration **before** the deploy, because the new code reads the new columns:

```
git pull
npx wrangler d1 migrations apply melanie-library --remote
npx wrangler deploy
```

## Shelf scan (where each book sits)

- Settings > Shelf scan: pick a place and a row, then scan that row's books left to right. The order is each book's spot. Books with no barcode are found by title. A pasted list (one ISBN or title a line, left to right) fills a row read from a photo. Nothing saves until Save row, and Undo puts the row back.
- Her six places: BILLY 1 to 4 (living room, 6 rows, glass doors), Kitchen counter case (kitchen, 7 cubbies) and Sofa console (living room, 2 shelves). A Bookcase 1 to 6 stand-in becomes one of these only if it still has its stand-in name and no books. A stand-in she renamed or used keeps its name and books, and the real place is added beside it.
- Settings > Subcategories and locations now also sets each place's room, how many rows, what one is called (Row, Cubby or Shelf) and glass doors. Fewer rows than a row that has books is refused.
- The list and the hub show the spot, like "BILLY 2 · Row 3, spot 5". Moving a book to another location (book page or Select) drops its old row; Undo after Select puts it back.
- Files: `migrations/0004_shelf_places.sql`, `src/shelf.js` (POST /api/books/spots), `src/sections.js` (place details), `public/shelf.js` (the screen). Tests: `test/shelf.test.mjs`.

This one changes the database: four new columns on locations, two on her copies, and an index, nothing renamed or removed. Run the migration **before** the deploy, because the new code reads the new columns:

```
npx wrangler d1 migrations apply melanie-library --remote
npx wrangler deploy
```

## Bookcases (each case drawn, books in their spots)

- Settings > Bookcases: one case at a time, picked by room (or Prev and Next). Each row shows its books standing left to right in their saved spots. Glass doors swing open when the case shows, and Close doors and Open doors move them again.
- Tap a spine to open the book page. Books in a place with no row yet are listed under the case.
- The book page has Show on the bookcase when the book has a place: it opens that case and points the book out. Back returns to the library or the hub, wherever she came from.
- Nothing here changes a book. It reads the spots that Shelf scan saves.
- When a book has a spine picture, the case shows the real spine, sized to the photo. Books without one keep a plain colored spine.
- Files: `public/cases.js` (the screen), styles at the end of `public/styles.css`. Tests: `test/cases.test.mjs`.

## Spine and cover pictures

- Settings > Add pictures takes a pictures file: spines cut from a photo of one row, and cover photos for books Open Library has no cover for. Each picture names the copy it's for, and goes to that book, so two copies of one book share it.
- A new picture replaces the book's earlier one, and the change log keeps what was there before.
- Pictures are kept in the backups bucket under `pictures/`, away from `nightly/`, so the nightly clean-up never touches them. A cover photo uses the same cover field as Open Library covers, so every screen shows it.
- The export spreadsheet now ends with the copy id, cover, spine picture, row and spot, so pictures can be matched to the right copies.
- Files: `src/pictures.js`, `public/pictures.js`, `migrations/0005_pictures.sql`. Tests: `test/pictures.test.mjs`.

This adds three columns to the books table, so run the migration first, then deploy:

```
npx wrangler d1 migrations apply melanie-library --remote
npx wrangler deploy
```

## Rules for every change

1. Structure changes only through a new numbered file in `migrations/`. Never edit a migration that has already run.
2. Migrations only add. Nothing is renamed or dropped in the same release that stops using it.
3. Run a new migration locally first, then on the live database.

## Try it on your Mac first (nothing touches your accounts)

```
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply melanie-library --local
npx wrangler dev
```

Then open http://localhost:8787. The local copy uses a pretend sign-in that only works on localhost.

## Set it up live (each step uses your Cloudflare account)

1. Sign in to Cloudflare from the terminal:
   ```
   npx wrangler login
   ```
2. Make the database, then paste the `database_id` it prints into `wrangler.jsonc` in place of `REPLACE_WITH_DATABASE_ID`:
   ```
   npx wrangler d1 create melanie-library
   ```
3. Make the backup bucket:
   ```
   npx wrangler r2 bucket create melanie-library-backups
   ```
4. Build the tables in the live database:
   ```
   npx wrangler d1 migrations apply melanie-library --remote
   ```
5. Store the two emails allowed in, separated by a comma. It asks you to type them, so they never sit in the code:
   ```
   npx wrangler secret put ALLOWED_EMAILS
   ```
6. Publish the app. It prints the app's address:
   ```
   npx wrangler deploy
   ```
7. Put Access in front of it. In the Cloudflare dashboard: Workers & Pages, open `melanie-library`, the Access tab, Protect this Worker behind Access, All traffic, and a policy that allows your two email addresses. Zero Trust has to be turned on for the account first.
8. Copy two values into `wrangler.jsonc`, then run `npx wrangler deploy` again:
   - `TEAM_DOMAIN`: your team domain, like https://yourteam.cloudflareaccess.com
   - `POLICY_AUD`: the Application Audience (AUD) Tag, in Zero Trust under Access controls, Applications, Edit on this app.
9. Open the address on the iPad, sign in with the code Cloudflare emails you, add a test book, and check it shows on your phone too. Then in Safari tap Share, Add to Home Screen.

Until step 8 is done, the app page opens but shows "Not signed in" and holds no data, because the API refuses anyone without an Access sign-in.

## Rolling back

- One book: Recently removed in the app, or the change log.
- The whole library to an earlier moment (D1 Time Travel keeps 30 days on the Workers Paid plan, 7 on Free): `npx wrangler d1 time-travel restore melanie-library --timestamp=<when>`. It overwrites the live database in place and prints a bookmark; `--bookmark=<that bookmark>` undoes it.
- Older than that, or if Time Travel can't help: the nightly copies in the `melanie-library-backups` bucket under `nightly/`, restored as below.

### Practice a restore on your Mac (touches nothing live)

Do this once so the steps are known before they're ever needed. Pick a day in the bucket, then:

```
npx wrangler r2 object get melanie-library-backups/nightly/<day>.json --remote --file backup.json
node scripts/backup-to-sql.mjs backup.json restore.sql
npx wrangler d1 migrations apply melanie-library --local --persist-to .restore-practice
npx wrangler d1 execute melanie-library --local --persist-to .restore-practice --file restore.sql -y
npx wrangler dev --persist-to .restore-practice
```

Open http://localhost:8787 and the library should look the way it did that night. The script prints how many rows each table has; the app's count should match its books line. Delete `backup.json`, `restore.sql` and `.restore-practice` afterwards (they hold her library, so never commit them).

### Restoring the live library from a nightly copy (emergency only)

1. Save a way back first: `npx wrangler d1 time-travel info melanie-library` and keep the bookmark it prints.
2. Make `restore.sql` from the copy as above.
3. `npx wrangler d1 execute melanie-library --remote --file restore.sql`
4. Refresh the app. If anything looks wrong, `npx wrangler d1 time-travel restore melanie-library --bookmark=<saved bookmark>` puts it back.

The restore replaces every table in the copy, so anything added after that night is gone unless it's re-added.

Copies made before this restore change is deployed don't hold subcategories or locations. Restoring one of those keeps the subcategories and locations already in the database, and books whose subcategory or location isn't there come back with none set.
