# 0003 — SQLite and FTS5

Status: accepted for foundation.

Searchable local history is a defining feature. Use bundled SQLite with FTS5, transactional numbered migrations, source records plus synchronized search projections, and an isolated idempotently seeded demo database. No network database or external indexer. Parameterized SQL and escaped plain-text FTS queries avoid query-language injection. Bound payloads/results. Prefix/token search differs from arbitrary substring search. Benchmark representative corpora before selecting virtualization/pagination thresholds; durable history is never a Zustand store.
