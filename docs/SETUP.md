# DeoDap SOP Campaign Tracker — Setup guide

The tracker reads DeoDap's Meta ad accounts every morning, checks every **active** campaign against the
nine SOP rules, rates its performance on the last 7 days, and keeps every audit for history and reports.

It is **read-only**: it asks Meta only for `ads_read` and its Meta client can only send GET requests. It never
creates, edits, pauses or deletes anything in Ads Manager.

---

## 1. What you need

| | |
|---|---|
| Server | Node.js 20+ **or** Docker |
| Storage | None to install: data is saved as JSON files in `server/data/` |
| Meta | A Meta app (App ID + secret), and either a Facebook login with access to the ad accounts or a Business Manager **system user** token with `ads_read` |
| HTTPS | Required in production (secure cookies). Use nginx, Caddy or your load balancer |

---

## 2. Run it locally (development)

```bash
npm install
cp .env.example server/.env        # then edit server/.env
npm run user:create -- --email you@deodap.com --name "Your Name" --role admin
npm run dev                        # API :4000, web app http://localhost:5173
```

`user:create` prints a **temporary password once**. Sign in with it; you will be asked to choose your own.

Generate the token encryption key and put it in `TOKEN_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Development sample data (optional)

```bash
npm run db:seed:dev     # loads labelled DEVELOPMENT data
npm run db:clear:dev    # removes it
```

Development data is never mistaken for Meta results: it is stored with `source = development`, uses `dev-…`
account IDs and `[DEV]` campaign names, shows a red **DEV DATA** banner, and is marked in report file names and
pages. A real Meta audit always takes priority on the dashboard. Clear it before going live.

---

## 3. Connect Meta

You can use either method (or both). The token is encrypted (AES-256-GCM) in the database and never sent to the
browser.

### Option A — System-user token (recommended for a daily job)

A system-user token does not expire, so the morning refresh never stops because someone's login lapsed.

1. In **Meta Business Suite → Business settings → Users → System users**, add a system user.
2. **Assign assets**: give it the DeoDap and Dabster ad accounts with view/read access.
3. **Generate new token**: choose your Meta app, tick **`ads_read`**, choose *never expire*.
4. In the tracker: **Meta & schedule → Or paste an access token**, paste it, **Check & save**.

**What is checked before anything is saved.** The token's status, type (user or system user), issuing app, expiry
and granted permissions (via Meta's `debug_token`; tokens of another app, e.g. Graph API Explorer, are inspected
by themselves), then which ad accounts it can see, and a test read of campaigns and insights per account.

- **Permissions:** `ads_read` is all the tracker needs (`ads_management` also works). Tokens with more permissions
  are accepted. `business_management` is optional: with it, Business portfolio names are shown; without it, they are
  not, and nothing else changes. (Asking Meta for the Business name without that permission gives
  `(#100) Requires business_management permission to access the field.` — the tracker no longer asks for it unless
  the token has the permission.)
- **Ad accounts:** found automatically through `me/adaccounts` (all pages). Accounts Meta does not list — for
  example ones shared from another Business — can be entered by ID when saving the token, or later with
  **Add ad account by ID**. An ID the token cannot see is explained (usually: assign the ad account to the system
  user in Business settings), and a token that can see no ad account at all is not saved.
- **Access per account** (Campaigns ✓/✗, Insights ✓/✗, with the reason) is shown in *Ad accounts to audit*.
  **Check again** re-runs all of this for a saved connection.
- **During a refresh**, campaigns and ad sets are required. If Meta refuses insights or some creative fields for an
  account, that account is still audited: affected ratings show *Not rated — not checkable* and checks show
  NOT CHECKABLE (never guessed), and History shows what could not be read.
- Tokens are stored encrypted on the server. Connections saved by earlier versions keep working; **Check again**
  adds the new details.

### Option B — Connect with Facebook login (OAuth)

1. At [developers.facebook.com](https://developers.facebook.com) create an app of type **Business** and add
   **Facebook Login for Business** (or Facebook Login) and the **Marketing API** product.
2. **App settings → Basic**: copy the App ID and App secret into the tracker under **Meta & schedule → Meta app**
   (or into `META_APP_ID` and `META_APP_SECRET` on the server).
3. **Facebook Login → Settings → Valid OAuth Redirect URIs**: add the redirect URI shown under
   **Meta & schedule → Meta app** (with a **Copy** button). Nothing needs configuring: the server works it out from
   the address the app is opened on, always ending in `/api/meta/oauth/callback`:
   - local development: `http://localhost:5173/api/meta/oauth/callback`
   - Render: `https://<service>.onrender.com/api/meta/oauth/callback`
   - custom domain: `https://<your-domain>/api/meta/oauth/callback` (https is used automatically in production)

   **Meta only accepts redirect URIs listed there, so each new address must be added once** — for example both the
   `onrender.com` address and a custom domain, if people use both. The login dialog and the token exchange always use
   the identical URI. Behind a reverse proxy, `X-Forwarded-Proto` / `X-Forwarded-Host` are used only from a trusted
   proxy: automatically on Render, elsewhere with `TRUST_PROXY=1`. A fixed URI can still be set (Settings or
   `META_REDIRECT_URI`) but is rarely needed.
4. In the tracker (as an admin): **Meta & schedule → Connect Meta**, sign in, allow `ads_read`.

Notes:
- While the app is in **Development mode**, only people with a role on the app (admin/developer/tester) can
  connect. To let anyone else connect, Meta requires App Review for `ads_read` (Advanced Access) and business
  verification.
- Facebook-login tokens last about 60 days. The Settings page shows the expiry and warns in the last week;
  click **Connect Meta** again to renew. A token Meta rejects (error 190) is marked "needs reconnecting".
- Menu names in Meta's tools change from time to time; the steps above may be labelled slightly differently.

### Choose the ad accounts

After connecting, every ad account the token can read is listed under **Ad accounts to audit**. Tick the ones
to audit (e.g. DeoDap `153787105` and Dabster `3149110605291089`). New accounts start unticked.

### First refresh and the daily schedule

- **Refresh now** (top bar, auditors and admins) starts a refresh straight away; the dashboard reloads when it ends.
- The daily refresh runs at `SYNC_TIME_IST` (default 07:30 IST). Admins can change or switch it off in
  **Meta & schedule**. If the server was down at that time, it catches up when it comes back.
- Only one refresh runs at a time (see *Refresh reliability* below).
- If one ad account fails (for example a missing permission) the others are still audited and the run is
  marked *partial*, with the reason shown in History.

---

## 4. Users and roles

| Role | Can |
|---|---|
| viewer | Read the dashboard, campaign details, history; download PDF/Excel |
| auditor | Viewer + record manual verification + start a refresh |
| admin | Auditor + Meta connection, ad-account selection, schedule, users |

Admins add users under **Users**. Each new user (and each password reset) gets a one-time temporary password
that must be changed at first sign-in. Deactivating a user signs them out everywhere immediately. The app always
keeps at least one active admin.

### The first admin

Either run `npm run user:create -- --email you@deodap.com --name "Your Name" --role admin` on the server, or — on
hosts without a shell before the first sign-in, such as Render — set these server environment variables:

```
INITIAL_ADMIN_EMAIL=you@deodap.com
INITIAL_ADMIN_PASSWORD=<at least 10 characters>
INITIAL_ADMIN_NAME=Your Name        # optional, default "Admin"
```

At start-up, **only if the data folder has no users at all**, the server creates that admin (password stored as a
scrypt hash, never in plain text) and you sign in on the normal login page. Once any user exists the variables are
ignored: they never overwrite, re-create or reset anyone, so changing them later does nothing (change the password
in the app under **Password**). You can remove them after the first sign-in. If only one is set, or the email or
password is invalid, the server refuses to start and says why.

---

## 5. Deploy to production

### With Docker (simplest)

```bash
cp .env.example .env
# set NODE_ENV=production, CLIENT_ORIGIN=https://<domain>,
# TOKEN_ENCRYPTION_KEY, META_APP_ID / META_APP_SECRET (or enter them in Settings), TRUST_PROXY=1
docker compose up -d --build
docker compose exec app npm run user:create -- --email you@deodap.com --name "Your Name" --role admin
```

The app listens on `127.0.0.1:4000`. Put HTTPS in front of it, for example nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name sop.example.com;
  # ssl_certificate / ssl_certificate_key …
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Without Docker

```bash
npm ci
npm run build                      # builds the web app into client/dist
NODE_ENV=production npm start      # serves API + web app on PORT
```

Run it under a process manager (systemd, pm2) so it restarts automatically. Run **one** server process per data
folder: the JSON storage is designed for a single instance.

### Production checklist

- [ ] `NODE_ENV=production` and HTTPS in front (cookies are `Secure`; HSTS is sent).
- [ ] `TRUST_PROXY=1` when behind a proxy.
- [ ] `CLIENT_ORIGIN` = the exact public URL.
- [ ] `TOKEN_ENCRYPTION_KEY` set and **backed up** separately from the data folder.
- [ ] Development data cleared (`npm run db:clear:dev`).
- [ ] `DATA_DIR` on a persistent disk or volume (see section 12); Data & backups shows no warning.
- [ ] Copies of the data folder off the server from time to time (daily backups are made inside it automatically).
- [ ] The redirect URI shown in **Meta & schedule → Meta app** (for each domain in use) is listed in the Meta app's *Valid OAuth Redirect URIs*.

---

## 6. How campaigns are judged

**Performance** uses Meta's `last_7d` insights (the 7 full days before today):

| Objective | Main metric | Good | Average | Bad |
|---|---|---|---|---|
| Sales | ROAS (purchase value ÷ spend) | ≥ 6.0 | 3.5 – 5.99 | < 3.5 |
| Traffic | Cost per landing page view | ≤ ₹0.30 | ≤ ₹0.70 | > ₹0.70 |
| Awareness | Cost per 1,000 reached | ≤ ₹2.70 | ≤ ₹3.40 | > ₹3.40 |
| Engagement | Cost per post engagement | ≤ ₹0.20 | ≤ ₹0.60 | > ₹0.60 |
| App Promotion | Cost per install | ≤ ₹1.20 | ≤ ₹2.00 | > ₹2.00 |
| Leads | Cost per lead, first 14 days | lowest 25% | middle 50% | highest 25% |

- No spend in 7 days → **Not rated**. Objectives outside the table → Not rated.
- Sales under ₹15,000 spend → rating marked **indicative**.
- The ₹ cost targets only apply to INR ad accounts. In other currencies, cost-based objectives are Not rated and
  Sales (ROAS) is rated but marked indicative.
- Spend with zero results (e.g. no landing page views) has no cost per result and is rated **Bad**, with the reason shown.
- Leads: each Leads campaign's cost per lead over its **first 14 days** is ranked against the other Leads
  campaigns in the same audit (percent rank < 25% Good, > 75% Bad). A campaign with no leads in its first 14 days is always Bad. Campaigns younger than 14 days, or fewer
  than four rankable Leads campaigns, are Not rated with the reason shown.

**SOP compliance**: SOP % = passed ÷ (passed + failed). All pass → Following SOP; ≤ 25% failing → Partly
following; > 25% → Not following; nothing checkable → Needs review. *Not checkable* and *Not applicable* never
count. A check result that is missing is treated as not checkable, never as a pass.

| Check | How it is read from Meta |
|---|---|
| Placements | Every active ad set's `publisher_platforms` must be exactly Facebook + Instagram + Threads. Missing = automatic placements = fail |
| Naming | Name contains the campaign's own objective word, a creative-format word and a date (`01.10.2026`, `03.11.26`, `2026-10-05`, `26 Oct`, …). Separators ignored |
| Bid strategy | Campaign-budget campaigns only: Sales = Highest volume, the other SOP objectives = Cost per result goal. Budget on ad sets, or an objective outside the SOP → not checkable |
| Frequency | Awareness only: every active ad set capped at ≤ 2 impressions per 7 days. No cap = fail |
| Min budget | Daily budget ≥ ₹800 (campaign budget, or each ad set). Lifetime-only budgets and non-INR accounts → not checkable |
| Seven Sisters | When India or a country group (e.g. worldwide) is targeted, all seven states must be in the excluded regions. Region/city-only targeting outside the north-east passes; postcode or radius targeting → not checkable |
| Creative complete | Every active ad has primary text and a CTA button (link, video, catalogue and flexible creatives). Boosted existing posts, whose text lives in the post → not checkable |
| Buying type | `AUCTION` |
| Dynamic creative | Off on every active ad set |

**Manual checks** (creative approval, next-day launch, stock, copy, SKU, coupon, custom-audience exclusions)
start as *Pending* and only change when an auditor or admin sets them. Each change is logged with who and when.
They are reported separately and listed under "What is off" when failed; they do not change the automated SOP %.

---

### Campaign counts: what counts as Active

A campaign is an **Active campaign** only when the campaign, **every** one of its ad sets and **every** one of its
ads have Meta `effective_status` **ACTIVE** (and it has not ended or is not still scheduled). If even one ad set or
ad is paused, off, archived, in review, in process, disapproved or otherwise not active, the whole campaign
is left out of the **Active campaigns** tile, the ratings and SOP tiles, the group tables and the default tracker
view. The parent campaign status alone is never trusted. Each campaign ID is counted once.

Section *Campaign counts* on the dashboard shows, per ad account (e.g. DeoDap, Dabster) and for **All accounts**:

| Column | Meaning |
|---|---|
| Total campaigns | Every non-deleted campaign in the ad account (Active, Paused, Archived, Other), each campaign ID once (also the **Total campaigns** tile) |
| Active campaigns | Strictly active as above (the **Active campaigns** tile) |
| Campaign status Active (audited) | Every campaign whose own `effective_status` is ACTIVE; all are still audited for the SOP |
| Not counted as Active | Why: some ad sets not active, some ads not active, no ad sets, no ads, ended, scheduled |
| Paused / Archived / Other | By Meta status (Other = in process, with issues) |
| Check | ✓ when Meta's count of ACTIVE campaigns equals the campaigns audited |

The tracker's **Show** filter switches between *Active campaigns* (default) and *All with campaign status Active*;
exports follow the same filter (`activity=all` in the export link). Unpublished drafts are not campaigns yet and are
never counted. Only the latest audit is counted; older audits stay in History. Audits made before this version show
"–" for Active until the next refresh.

How it is read (all read-only): campaigns with status ACTIVE; for those campaigns only (filtered by campaign ID, 50 per
request, all pages), their ad sets in every non-deleted status and a light list of their non-active ads; plus one
listing of all non-deleted campaigns for the totals. If Meta refuses the campaign filter, the tracker reads the
account's ad sets and ads and filters them itself.

**Deleted objects are never requested.** Meta refuses `DELETED` in status filters on the campaigns, ad sets and ads
lists (`(#100) Requesting for deleted objects is not supported in this endpoint`, error 100/1815001), so the tracker
never asks for them, and its Meta client removes `DELETED` from any status filter as a safety net. Deleted campaigns
are not current data and are not in any current total; audits made before they disappeared keep them in History.

Real example, DeoDap ad account, 7 Nov 2026 15:40 IST: 903 campaigns (70 Active, 764 Paused, 69 Archived);
**35 strictly active**. The other 35 with status Active have some ads not active (16), some ad sets not active (14),
no ad sets (3) or have ended (2). This rule is stricter than Ads Manager's "Active" (delivering), so the tile can be
lower than Ads Manager on purpose.

### Refresh reliability

- One refresh at a time: **Refresh now** is disabled while one runs, and a second request is refused (no extra
  history record). Each attempt ends as exactly one record: *succeeded*, *partial* (names the failed account and why)
  or *failed*. A partial or failed refresh is never shown as successful; the dashboard keeps the last good audit.
- While it runs, a panel shows the account being read (e.g. *Account 2 of 2: Dabster*), the step, and any wait.
  When it ends: *“Meta data loaded successfully. Please check your Dashboard.”*, or the failed accounts with the reason.
- Meta rate limits (codes 4, 17, 32, 613, 80000–80014) are retried automatically with exponential back-off
  (15 s, 30 s, 1, 2, 4, 5 min; longer when Meta says so), up to 6 times per request. The tracker also slows down when
  Meta's usage headers report 75 % or more of the limit. Ad accounts are read one after another, with at most two
  requests at a time per account.
- If the server restarts during a refresh (e.g. a redeploy), the refresh starts again under the same history record.
  Only if that happens twice is it marked failed with "Stopped twice by a server restart".

## 7. Reports and exports

Every screen that shows data has an **Export** button. Pick the report, the format — **PDF, Excel (.xlsx),
Word (.docx) or CSV** — and the records: **current filters** (what the screen shows) or **all records**.

| Where | Reports offered |
|---|---|
| Dashboard header | Dashboard report, and every report below for the audit on screen |
| By account / By objective cards | Account-wise report, Objective-wise report |
| “Which SOP rules break most often” | SOP rules and compliance, Failed checks |
| Campaign tracker toolbar | Campaign tracker, Performance, Failed checks, Manual verification, Creative audit, Ad set details |
| Campaign page | Campaign detail (checks, settings, ad sets, ads, manual checks with evidence names, history), Ad set details, Creative audit, Manual verification |
| History | Audit history (with a From/To date range), any past audit, **Compare two audits** (historical comparison) |

- **Excel** has an *About* sheet (audit, filters, who generated it) and one sheet per table, with frozen headers,
  filters and real number, ₹ and date formats. **Word** and **PDF** are formatted reports with the same tables
  (landscape when the tables are wide, page numbers, repeated table headers). **CSV** is the report's main table,
  UTF-8 with a BOM so Excel shows ₹ correctly; text that a spreadsheet could run as a formula is neutralised.
- Development data is labelled in the file name (`…-DEV-DATA.xlsx`), at the top of every report, and on every CSV row.
- Exports never contain passwords, tokens, App Secrets or session data. Every signed-in user (viewer and up) can
  export the audit data they can see.
- Every generated file is kept on the server (`data/reports/`) and listed under **History → Recent exports** for
  the person who made it (admins see all), so it can be downloaded again. The newest `REPORTS_KEEP` files are kept
  (default 300).
- Large exports: Excel and CSV are written row by row and include every row. Word and PDF are for reading, so a very
  long table is cut (PDF 3,000 rows; Word about 15,000 cells) with a note pointing to Excel or CSV. At most
  `EXPORT_CONCURRENCY` exports (default 2) are built at once; others wait.
- API: `GET /api/exports/<report>.<pdf|xlsx|docx|csv>?runId=…&scope=filtered|all&accountId=…&rating=…&objective=…&sopStatus=…&search=…&sort=…`
  (`campaignId` for one campaign, `from`/`to` for history, `runA`/`runB` for the comparison).
- From the command line (e.g. a cron job):
  `npm run report:export -- --run latest --format pdf --out ./reports --rating BAD`

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| "Meta is not configured" | Enter the App ID and App Secret under **Meta & schedule → Meta app** (or set `META_APP_ID`, `META_APP_SECRET`) |
| Facebook says the redirect URI is not allowed ("URL blocked") | Copy the redirect URI from **Meta & schedule → Meta app**, opened on the same domain, into *Valid OAuth Redirect URIs*. Each domain needs its own entry. |
| Run *partial*, "This token cannot see ad account …" | The token's user/system user is not assigned to that ad account; assign it in Business settings, then **Check again** |
| "(#100) Requires business_management permission to access the field." | Fixed in this version (the field is only read when the token has that optional permission). Update and redeploy. |
| Connection "needs reconnecting" | Token expired or revoked: Connect Meta again or paste a new system-user token |
| "Meta rate limit reached" | Meta throttled the account; the client already retried with backoff. The next refresh will try again |
| Signed out right after signing in (production) | Serve over HTTPS, or set `TRUST_PROXY=1` behind a proxy (automatic on Render) |
| Lost `TOKEN_ENCRYPTION_KEY` | Set a new key, remove the connection in Settings and connect again; audit history is unaffected |

---

## 9. Tests

```bash
npm run typecheck
npm test     # unit tests + API/integration tests (they use a temporary data folder, never server/data)
```

The integration tests use a fake Meta Graph API that lives only in `server/test/`. The running application
always talks to `graph.facebook.com`.

---

## 10. Shareable preview (no server)

A static, clickable preview of the web app can be built from the **development** sample data only:

```bash
npm run db:seed:dev
npm run preview:snapshot --workspace server   # refuses anything but development data
npm run build:preview --workspace client      # output in client/dist-preview
```

The preview runs the real interface against an in-browser copy of that data. Nothing is saved, and Meta
refresh, live ad previews and downloads are disabled.

`client/src/preview/snapshot.json` is generated sample data, so it is git-ignored and never deployed. The
production build (`npm run build`, used by Docker and hosts such as Render) does not include or type-check
`src/preview/`, so it works without the snapshot. Only `build:preview` needs it, and it says how to make it when
it is missing.

---

## 11. Data storage

All application data lives in **one folder on the server**: `server/data/` by default, or the folder in
`DATA_DIR`. Nothing is kept in the browser except the sign-in cookie.

| In the data folder | Holds |
|---|---|
| `users.json`, `sessions.json` | People, roles, password hashes, sign-in sessions (only a hash of each session token) |
| `settings.json` | Meta app details (App Secret **encrypted**), daily refresh time, every SOP rule-set version used |
| `meta-connections.json`, `oauth-states.json` | Meta connections with the **encrypted** token, OAuth sign-in states |
| `ad-accounts.json` | Connected ad accounts and which ones are audited |
| `audit-runs.json` | Every refresh: status, period, per-account result, totals, SOP rule-set version |
| `audits/run-<id>.json` | The campaigns of one refresh: SOP checks, compliance, ratings, insights, ad sets, ads and creatives as Meta returned them |
| `campaign-index.json` | Finds a campaign or ad across runs without opening every run file |
| `manual-checks.json`, `manual-check-events.json` | Manual verifications and their change log |
| `attachments.json`, `attachments/` | Evidence files for manual checks |
| `generated-reports.json`, `reports/` | Exported files, for downloading again |
| `secret.key` | Token encryption key, created when `TOKEN_ENCRYPTION_KEY` is not set (file mode 600) |
| `backups/` | Automatic and manual backups |
| `storage.json`, `sequence-*.json`, `server.pid` | Folder marker, id counters, lock of the running server |

**Safe writes.** Every change is on disk before the request finishes. Files are written to a temporary file and
renamed over the old one, so a crash never leaves a half-written file. Each collection file carries a SHA-256
checksum of its rows.

**Integrity checks at start-up.** Every file is checked (valid JSON, expected structure, unique ids, checksum).
A file that is damaged is restored automatically from the newest backup that has a good copy, and the damaged copy
is kept next to it (`*.damaged-<time>`). If no backup can repair it, the server refuses to start instead of
starting empty — data is never silently lost. A checksum mismatch on otherwise valid JSON (a hand edit) is accepted
and reported.

**Backups.** One is made automatically every day (and before every restore). Admins can make one under
**Meta & schedule → Data & backups → Back up now**, or on the server:

```bash
npm run data -- backup             # make a backup now
npm run data -- list               # list backups
npm run data -- verify <name>      # check every file in a backup against its checksums
npm run data -- restore <name>     # stop the server first; a safety backup of the current data is made first
```

The newest `BACKUP_KEEP` backups are kept (default 14). Unchanged files are hard-linked between backups, so daily
backups take little space. Backups live inside the data folder: also copy the folder (or `backups/`) to another
machine or bucket from time to time, and keep `TOKEN_ENCRYPTION_KEY` (or `secret.key`) somewhere safe — without it,
stored Meta connections must be reconnected.

**Storage warnings.** The server checks at start-up and on the Data & backups page whether data will survive: the
folder must be writable and outside the public web folder; it warns on hosts without a persistent disk, in a
container without a mounted volume, in production with `DATA_DIR` unset, and when the last backup is over two days
old. When storage is not safe, every signed-in user sees a banner and admins see the details.

Other notes:
- The files on disk are the source of truth. When a command-line tool (for example `user:create`) changes them while
  the server runs, the server picks up the change.
- Run **one** server process per data folder (the server takes a lock; `restore` refuses while it runs).
- The earlier PostgreSQL schema is kept in `server/db-schema-postgres/`, for adding a PostgreSQL backend later
  behind the same storage interface (`server/src/storage/`).

## 12. Hosting: keeping data across redeploys

The data folder must be on storage that outlives the app's code. Set `DATA_DIR` to that place.

| Host | What to do |
|---|---|
| **Docker / docker compose** | Already set up: the image uses `DATA_DIR=/app/server/data` and `docker-compose.yml` mounts the named volume `data` there. `docker compose down` keeps it; **`docker compose down -v` deletes it**. To use a host folder instead: `volumes: ["/srv/sop-data:/app/server/data"]`. |
| **VPS / own server (systemd, pm2)** | `DATA_DIR=/var/lib/sop-tracker/data` (outside the code folder, owned by the app's user). Deploying new code never touches it. |
| **Render** | Add a *Disk* with mount path `/var/data` and set `DATA_DIR=/var/data`. Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` for the first sign-in (section 4). Without the disk, users and data are lost on every deploy. |
| **Railway** | Add a *Volume* to the service (e.g. `/data`) and set `DATA_DIR=/data`. |
| **Fly.io** | `fly volumes create sop_data`, mount it in `fly.toml` (`[mounts] source="sop_data" destination="/data"`), set `DATA_DIR=/data`. Run one machine. |
| **DigitalOcean App Platform, Heroku, Vercel, Netlify, AWS Lambda** | Not suitable as they are: their file systems are reset on deploy or restart. Use a host above, or add a PostgreSQL backend later. The app shows a warning on these hosts. |

After the first deploy, open **Meta & schedule → Data & backups** and check that it says *Data is stored on the server
and kept across restarts*, then redeploy once and confirm your users and audits are still there.

