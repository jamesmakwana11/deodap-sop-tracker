# PostgreSQL schema (reference)

The tracker currently stores everything as JSON files in `server/data/` (see `src/storage/`).
These SQL files are the earlier PostgreSQL schema, kept as the starting point for a future
PostgreSQL backend. The record shapes in `src/storage/records.ts` map onto these tables.

To add PostgreSQL later: implement the `Collection` interface from `src/storage/collection.ts`
(plus the per-run audit read/write methods of `src/storage/store.ts`) on top of these tables,
and choose the backend in `openStore()`. The repositories and the rest of the app do not change.
