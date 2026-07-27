-- Desktop local store (PROMPT §4). A read-only MIRROR of the server corpus plus
-- an FTS5 index, and LOCAL-FIRST writable tables for the user's own work.
--
-- The full-text index is the entire reason this is a desktop app: searching
-- ~300k spans must return in under 50ms (PROMPT §3). FTS5 delivers that offline.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Read-only mirror of the corpus ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payer (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  parent_payer_id TEXT
);

CREATE TABLE IF NOT EXISTS covered_lives (
  id          TEXT PRIMARY KEY,
  payer_id    TEXT NOT NULL REFERENCES payer(id),
  year        INTEGER NOT NULL,
  segment     TEXT NOT NULL,
  lives_count INTEGER NOT NULL,
  source_url  TEXT NOT NULL,
  source_note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code (
  id          TEXT PRIMARY KEY,
  system      TEXT NOT NULL,
  code        TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_document (
  id             TEXT PRIMARY KEY,
  payer_id       TEXT NOT NULL REFERENCES payer(id),
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  retrieved_at   TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  supersedes_id  TEXT,
  raw_storage_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS policy_document_payer_idx ON policy_document(payer_id);

CREATE TABLE IF NOT EXISTS document_span (
  id                 TEXT PRIMARY KEY,
  policy_document_id TEXT NOT NULL REFERENCES policy_document(id),
  ordinal            INTEGER NOT NULL,
  page_number        INTEGER NOT NULL,
  char_start         INTEGER NOT NULL,
  char_end           INTEGER NOT NULL,
  text               TEXT NOT NULL,
  heading_path       TEXT NOT NULL DEFAULT '[]' -- JSON array
);
CREATE INDEX IF NOT EXISTS document_span_doc_idx ON document_span(policy_document_id);

CREATE TABLE IF NOT EXISTS policy_code_link (
  policy_document_id TEXT NOT NULL REFERENCES policy_document(id),
  code_id            TEXT NOT NULL REFERENCES code(id),
  relationship       TEXT NOT NULL,
  PRIMARY KEY (policy_document_id, code_id, relationship)
);

-- The citation invariant survives the mirror: span_id + verbatim_quote NOT NULL.
CREATE TABLE IF NOT EXISTS criterion (
  id                 TEXT PRIMARY KEY,
  policy_document_id TEXT NOT NULL REFERENCES policy_document(id),
  kind               TEXT NOT NULL,
  subject            TEXT NOT NULL,
  requirement_text   TEXT NOT NULL,
  operator           TEXT,
  value              TEXT,
  unit               TEXT,
  evidence           TEXT NOT NULL DEFAULT '{}', -- JSON
  span_id            TEXT NOT NULL REFERENCES document_span(id),
  verbatim_quote     TEXT NOT NULL,
  confidence         REAL NOT NULL,
  extracted_by_model TEXT NOT NULL,
  extracted_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS criterion_doc_idx ON criterion(policy_document_id);
CREATE INDEX IF NOT EXISTS criterion_kind_idx ON criterion(kind);

CREATE TABLE IF NOT EXISTS coverage_stance (
  id                 TEXT PRIMARY KEY,
  policy_document_id TEXT NOT NULL REFERENCES policy_document(id),
  code_id            TEXT NOT NULL REFERENCES code(id),
  stance             TEXT NOT NULL,
  span_id            TEXT NOT NULL REFERENCES document_span(id),
  verbatim_quote     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coverage_stance_doc_idx ON coverage_stance(policy_document_id);

CREATE TABLE IF NOT EXISTS criterion_change (
  id                 TEXT PRIMARY KEY,
  from_criterion_id  TEXT,
  to_criterion_id    TEXT,
  policy_document_id TEXT NOT NULL REFERENCES policy_document(id),
  change_type        TEXT NOT NULL,
  rationale          TEXT NOT NULL
);

-- ── Full-text index over span.text AND criterion.requirement_text ────────────
-- Standalone FTS5 (text duplicated in) so a single MATCH searches everything and
-- returns where each hit came from. UNINDEXED columns carry the join metadata.
CREATE VIRTUAL TABLE IF NOT EXISTS corpus_fts USING fts5(
  text,
  source_type        UNINDEXED, -- 'span' | 'criterion'
  source_id          UNINDEXED,
  policy_document_id UNINDEXED,
  payer_id           UNINDEXED,
  heading            UNINDEXED,
  tokenize = 'porter unicode61'
);

-- ── Local-first writable tables (the user's own work) ────────────────────────
-- Each carries updated_at and sync_state ('clean' | 'dirty' | 'conflict').

CREATE TABLE IF NOT EXISTS asset (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  indication       TEXT NOT NULL,
  intended_use     TEXT NOT NULL,
  target_codes     TEXT NOT NULL DEFAULT '[]', -- JSON
  comparator       TEXT NOT NULL DEFAULT '',
  target_population TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL,
  sync_state       TEXT NOT NULL DEFAULT 'dirty'
);

CREATE TABLE IF NOT EXISTS evidence_item (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL REFERENCES asset(id),
  title       TEXT NOT NULL,
  citation    TEXT NOT NULL DEFAULT '',
  study_design TEXT,
  endpoint    TEXT,
  claim       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  sync_state  TEXT NOT NULL DEFAULT 'dirty'
);

CREATE TABLE IF NOT EXISTS campaign_entry (
  id               TEXT PRIMARY KEY,
  asset_id         TEXT NOT NULL REFERENCES asset(id),
  payer_id         TEXT NOT NULL,
  stage            TEXT NOT NULL DEFAULT 'not_engaged',
  owner            TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  next_action_date TEXT,
  updated_at       TEXT NOT NULL,
  sync_state       TEXT NOT NULL DEFAULT 'dirty'
);

CREATE TABLE IF NOT EXISTS annotation (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL, -- 'span' | 'criterion' | 'policy'
  target_id   TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  sync_state  TEXT NOT NULL DEFAULT 'dirty'
);

-- Sync bookkeeping: last pull cursor, and a per-field conflict log so a user's
-- campaign note is never silently dropped (PROMPT §10).
CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conflict_log (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  field       TEXT NOT NULL,
  local_value TEXT,
  remote_value TEXT,
  resolved_to TEXT NOT NULL, -- 'local' | 'remote'
  created_at  TEXT NOT NULL
);
