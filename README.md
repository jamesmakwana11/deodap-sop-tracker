# DeoDap SOP Campaign Tracker

Read-only auditor for DeoDap's Meta ad accounts. Every active campaign gets two independent verdicts:

- **Performance** — Good / Average / Bad / Not rated, from the last 7 days of Meta insights.
- **SOP compliance** — Following / Partly following / Not following / Needs review, from nine automated checks,
  plus seven manual checks that only a person can mark.

Setup, Meta connection, deployment and the exact rules: **[docs/SETUP.md](docs/SETUP.md)**.

## Features

- Meta OAuth (Facebook login) or Business Manager system-user token; tokens encrypted at rest
- Multiple ad accounts, chosen by an admin
- Daily refresh at a set IST time, catch-up after downtime, and a manual **Refresh now**
- All nine SOP checks with Pass / Fail / Not checkable / Not applicable kept apart
- Performance ratings per objective, indicative Sales ratings, Leads ranked on first-14-day cost per lead
- Dashboard: KPI tiles, by account, by objective, most-failed rules, filterable/sortable tracker
- Campaign detail: settings, active ad sets, active ads with thumbnails and live Meta previews, history
- Manual verification with an audit trail and evidence files
- Every refresh kept as an audit; open any past audit as it was; compliance trend
- Export buttons everywhere: 13 reports in PDF, Excel, Word and CSV, current filters or all records; saved for re-download
- All data on the server in one folder: safe writes, checksums, automatic recovery, daily backups, restore, storage warnings
- Users with viewer / auditor / admin roles

## Stack

| Part | Tech |
|---|---|
| `shared/` | TypeScript domain model: rule catalogue, rating thresholds, compliance scoring, summaries, filters, formatting |
| `server/` | Node + Express, JSON file storage in `server/data/` (no database needed), Meta Graph API client (GET only), ExcelJS, PDFKit, docx |
| `client/` | React 18 + TypeScript + Vite + Tailwind CSS v4 + React Router |

## Commands

```bash
npm run dev              # API :4000 + web app :5173
npm test                 # unit + integration tests
npm run typecheck
npm run build            # build the web app
npm start                # production: API + built web app
npm run user:create -- --email you@deodap.com --name "You" --role admin
npm run data -- backup | list | verify <name> | restore <name>
npm run report:export -- --run latest --format xlsx --out ./reports
npm run db:seed:dev      # labelled DEVELOPMENT sample data (never shown as Meta results)
npm run db:clear:dev
docker compose up -d --build
```

## Layout

```
shared/src      types, SOP rules, rating rules, compliance, summaries, filters, formatting
server/src
  audit/        nine SOP checks, naming parser, ratings, objective mapping
  meta/         Graph client (read-only), OAuth, account fetcher, raw types
  services/     sync, scheduler, Meta connections, campaign detail, dashboard
  repositories/ data access (uses storage/)
  storage/      JSON file storage: collections, per-run audit files, backups, integrity checks
  exports/      13 report definitions and the PDF / Excel / Word / CSV renderers
  reports/      dashboard Excel and PDF builders
  routes/       auth, users, meta, sync/runs, campaigns, attachments, reports, exports, system, dashboard
server/test     unit + integration tests (fake Meta lives only here)
client/src      pages, components, auth, sync status
server/data     the JSON data files (created at first start, not in git)
server/db-schema-postgres   reference SQL for a future PostgreSQL backend
docs/SETUP.md   setup and deployment guide
```
