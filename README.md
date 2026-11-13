# Melanie's library

A home-screen web app for her books. One Cloudflare Worker serves the app and its API, her library lives in a D1 database, and a copy goes to R2 every night (the last 30 are kept). Cloudflare Access decides who can open it: only Daniel and Melanie.

## What's in weekend 1

- `migrations/0001_initial.sql`: every table the Christmas plan needs. Books, her copies, statuses, lists (owned, wish list, borrowed, previously owned), collections, tags, custom fields, a change log, and import tables that keep every original Libib row.
- `src/index.js`: the API. Add, edit, remove (hidden, never erased), restore, search, filter, rename a status, export a spreadsheet. Every change is written to the change log. It checks the Access sign-in on every request and only lets the two allowed emails in.
- `src/backup.js`: the nightly copy to R2, deleting anything older than the newest 30.
- `public/`: the app itself, dark theme, list or cover view, add a book by hand, tap a status to change it, remove with undo, a Recently removed view.

Statuses start as Libib's four: Not begun, In progress, Completed, Abandoned. Books store a fixed code, so renaming a status never touches a book.

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
