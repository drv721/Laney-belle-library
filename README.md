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
- The whole library, last 7 days: `npx wrangler d1 time-travel restore melanie-library --timestamp=<when>`
- Days 8 to 30: the nightly copies in the `melanie-library-backups` bucket under `nightly/`.
