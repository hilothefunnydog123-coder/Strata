"""The claim-centered data model — Strata's spine and its long-term moat.

The core object here is not the paper. It is the **claim**. Everything hangs off
it: the evidence linked to it, the transparent assessment of that evidence, and —
the part nobody else keeps — the *versioned history* of how that assessment
changed as new literature arrived. That historical evidence-change graph is the
asset a competitor cannot clone by also calling PubMed.

    Organization → Workspace → TherapeuticArea → Claim → ClaimVersion
                                                    ↓
                                  EvidenceItem → Study
                                                    ↓
                                          Assessment (on the version)
                                                    ↓
                                     ChangeEvent → Alert   (over time)

Storage is SQLite from the standard library — no dependency, a real relational
schema, real foreign keys, real transactions, and a genuine audit trail. It runs
from a single file and scales to the demo and well beyond; the access layer is
deliberately thin so a future move to Postgres is a driver swap, not a rewrite.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import sqlite3
import threading
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional


def now_iso() -> str:
    """UTC timestamp, second precision, ISO-8601 — the one clock the system uses."""
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _slug(text: str) -> str:
    import re
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or "item"


SCHEMA = r"""
PRAGMA foreign_keys = ON;

-- Tenancy & access ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    name        TEXT,
    role        TEXT NOT NULL DEFAULT 'member',   -- admin | member | viewer
    created_at  TEXT NOT NULL,
    UNIQUE(org_id, email)
);

CREATE TABLE IF NOT EXISTS workspaces (
    id          INTEGER PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(org_id, slug)
);

CREATE TABLE IF NOT EXISTS therapeutic_areas (
    id            INTEGER PRIMARY KEY,
    workspace_id  INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    UNIQUE(workspace_id, slug)
);

-- Claims -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
    id                  INTEGER PRIMARY KEY,
    workspace_id        INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    therapeutic_area_id INTEGER REFERENCES therapeutic_areas(id) ON DELETE SET NULL,
    text                TEXT NOT NULL,
    population          TEXT,          -- json
    intervention        TEXT,
    comparator          TEXT,
    outcome             TEXT,
    status              TEXT NOT NULL DEFAULT 'unverified',   -- supported|partially_supported|contested|unsupported|insufficient_evidence|unverified
    evidence_strength   TEXT NOT NULL DEFAULT 'none',         -- high|moderate|low|very low|none
    trend               TEXT NOT NULL DEFAULT 'stable',       -- strengthening|weakening|stable|new
    current_version     INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    last_verified_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_claims_ws ON claims(workspace_id);
CREATE INDEX IF NOT EXISTS ix_claims_ta ON claims(therapeutic_area_id);

-- A new version is written every time the evidence assessment changes
-- materially. This is the historical timeline — the core data asset.
CREATE TABLE IF NOT EXISTS claim_versions (
    id                  INTEGER PRIMARY KEY,
    claim_id            INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    status              TEXT NOT NULL,
    evidence_strength   TEXT NOT NULL,
    best_level          INTEGER,
    supporting_count    INTEGER NOT NULL DEFAULT 0,
    contradicting_count INTEGER NOT NULL DEFAULT 0,
    neutral_count       INTEGER NOT NULL DEFAULT 0,
    assessment          TEXT,          -- json: full transparent EvidenceAssessment
    summary             TEXT,
    evidence_fingerprint TEXT,         -- stable hash of the evidence set, for change detection
    created_at          TEXT NOT NULL,
    UNIQUE(claim_id, version)
);

-- Studies & evidence -------------------------------------------------------
-- A study is a de-duplicated bibliographic record, shared across claims.
CREATE TABLE IF NOT EXISTS studies (
    id                 INTEGER PRIMARY KEY,
    dedup_key          TEXT NOT NULL UNIQUE,      -- doi | pmid | normalized-title
    source             TEXT,                      -- pubmed | europepmc | openalex | ...
    pmid               TEXT,
    doi                TEXT,
    title              TEXT,
    abstract           TEXT,
    journal            TEXT,
    year               INTEGER,
    authors            TEXT,          -- json
    publication_types  TEXT,          -- json
    url                TEXT,
    has_full_text      INTEGER NOT NULL DEFAULT 0,
    extraction         TEXT,          -- json: structured, provenance-tagged extraction
    first_seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_studies_pmid ON studies(pmid);
CREATE INDEX IF NOT EXISTS ix_studies_doi ON studies(doi);

-- Links a claim (at a version) to a study, with the per-claim analysis: is it
-- supporting or contradicting, why, how strong, and how well the population fits.
CREATE TABLE IF NOT EXISTS evidence_items (
    id               INTEGER PRIMARY KEY,
    claim_id         INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    claim_version    INTEGER NOT NULL,
    study_id         INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    stance           TEXT NOT NULL,             -- supporting|contradicting|neutral|unclear
    stance_reason    TEXT,
    disagreement_type TEXT,                     -- population|dose|outcome|design|severity|statistical|genuine|null
    relevance_score  REAL,
    grade_level      INTEGER,
    grade_label      TEXT,
    strength         TEXT,
    effect           TEXT,          -- json: effect estimate + provenance
    population_match TEXT,          -- json
    created_at       TEXT NOT NULL,
    UNIQUE(claim_id, claim_version, study_id)
);
CREATE INDEX IF NOT EXISTS ix_ev_claim ON evidence_items(claim_id, claim_version);

-- Monitoring & change ------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitors (
    id               INTEGER PRIMARY KEY,
    claim_id         INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    frequency        TEXT NOT NULL DEFAULT 'weekly',   -- daily|weekly|monthly
    conditions       TEXT,          -- json list of alert conditions
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    last_run_at      TEXT,
    next_run_at      TEXT,
    UNIQUE(claim_id)
);

CREATE TABLE IF NOT EXISTS change_events (
    id            INTEGER PRIMARY KEY,
    claim_id      INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    from_version  INTEGER,
    to_version    INTEGER,
    change_type   TEXT NOT NULL,   -- new_rct|new_meta_analysis|new_contradiction|strength_change|new_study|effect_change|new_population|status_change
    impact        TEXT,            -- high|moderate|low
    summary       TEXT NOT NULL,
    detail        TEXT,            -- json
    study_id      INTEGER REFERENCES studies(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_change_claim ON change_events(claim_id);
CREATE INDEX IF NOT EXISTS ix_change_created ON change_events(created_at);

CREATE TABLE IF NOT EXISTS alerts (
    id                 INTEGER PRIMARY KEY,
    claim_id           INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    change_event_id    INTEGER REFERENCES change_events(id) ON DELETE CASCADE,
    monitor_id         INTEGER REFERENCES monitors(id) ON DELETE SET NULL,
    level              TEXT NOT NULL DEFAULT 'info',   -- critical|warning|info
    title              TEXT NOT NULL,
    body               TEXT,
    recommended_action TEXT,
    status             TEXT NOT NULL DEFAULT 'new',    -- new|read|resolved
    created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alerts_status ON alerts(status);

-- Platform: API keys, usage, demo requests ---------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id                 INTEGER PRIMARY KEY,
    org_id             INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    name               TEXT,
    prefix             TEXT NOT NULL,             -- shown to the user, e.g. sk_live_ab12cd
    key_hash           TEXT NOT NULL UNIQUE,      -- sha256 of the full key; the key itself is never stored
    scopes             TEXT,          -- json
    rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
    active             INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL,
    last_used_at       TEXT,
    revoked_at         TEXT
);
CREATE INDEX IF NOT EXISTS ix_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_usage (
    id           INTEGER PRIMARY KEY,
    api_key_id   INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
    ts           TEXT NOT NULL,
    endpoint     TEXT,
    method       TEXT,
    status_code  INTEGER,
    latency_ms   INTEGER,
    units        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_usage_key_ts ON api_usage(api_key_id, ts);

CREATE TABLE IF NOT EXISTS demo_requests (
    id            INTEGER PRIMARY KEY,
    name          TEXT,
    email         TEXT NOT NULL,
    organization  TEXT,
    role          TEXT,
    company       TEXT,
    use_case      TEXT,
    source        TEXT,
    created_at    TEXT NOT NULL,
    delivered     INTEGER NOT NULL DEFAULT 0,
    delivery_note TEXT
);
"""


def _jdump(obj: Any) -> Optional[str]:
    return None if obj is None else json.dumps(obj, ensure_ascii=False)


def _jload(text: Optional[str], default: Any = None) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return default


def _row(r: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    return dict(r) if r is not None else None


class Database:
    """Thin, thread-safe data-access layer over SQLite.

    ``http.server`` handles each request on its own thread, so every write goes
    through a single connection guarded by a lock. That is more than enough for
    the Console, the API, and the monitoring worker; the boundary is small and
    swappable when the load justifies a real database.
    """

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path or os.environ.get("STRATA_DB", "strata.db")
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    # -- low level ----------------------------------------------------------
    def execute(self, sql: str, params: Iterable = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            self._conn.commit()
            return cur

    def query(self, sql: str, params: Iterable = ()) -> List[Dict[str, Any]]:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            return [dict(r) for r in cur.fetchall()]

    def one(self, sql: str, params: Iterable = ()) -> Optional[Dict[str, Any]]:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            return _row(cur.fetchone())

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # -- tenancy ------------------------------------------------------------
    def create_org(self, name: str, slug: Optional[str] = None) -> int:
        slug = slug or _slug(name)
        cur = self.execute(
            "INSERT INTO organizations(name, slug, created_at) VALUES (?,?,?)",
            (name, slug, now_iso()))
        return cur.lastrowid

    def get_or_create_org(self, name: str, slug: Optional[str] = None) -> int:
        slug = slug or _slug(name)
        row = self.one("SELECT id FROM organizations WHERE slug=?", (slug,))
        return row["id"] if row else self.create_org(name, slug)

    def create_workspace(self, org_id: int, name: str, slug: Optional[str] = None) -> int:
        slug = slug or _slug(name)
        cur = self.execute(
            "INSERT INTO workspaces(org_id, name, slug, created_at) VALUES (?,?,?,?)",
            (org_id, name, slug, now_iso()))
        return cur.lastrowid

    def get_or_create_workspace(self, org_id: int, name: str, slug: Optional[str] = None) -> int:
        slug = slug or _slug(name)
        row = self.one("SELECT id FROM workspaces WHERE org_id=? AND slug=?", (org_id, slug))
        return row["id"] if row else self.create_workspace(org_id, name, slug)

    def ensure_therapeutic_area(self, workspace_id: int, name: str) -> int:
        slug = _slug(name)
        row = self.one(
            "SELECT id FROM therapeutic_areas WHERE workspace_id=? AND slug=?",
            (workspace_id, slug))
        if row:
            return row["id"]
        cur = self.execute(
            "INSERT INTO therapeutic_areas(workspace_id, name, slug, created_at) VALUES (?,?,?,?)",
            (workspace_id, name, slug, now_iso()))
        return cur.lastrowid

    # -- claims -------------------------------------------------------------
    def create_claim(self, workspace_id: int, text: str, *, population: Any = None,
                     intervention: str = "", comparator: str = "", outcome: str = "",
                     therapeutic_area_id: Optional[int] = None) -> int:
        ts = now_iso()
        cur = self.execute(
            "INSERT INTO claims(workspace_id, therapeutic_area_id, text, population, "
            "intervention, comparator, outcome, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (workspace_id, therapeutic_area_id, text, _jdump(population),
             intervention, comparator, outcome, ts, ts))
        return cur.lastrowid

    def get_claim(self, claim_id: int) -> Optional[Dict[str, Any]]:
        row = self.one("SELECT * FROM claims WHERE id=?", (claim_id,))
        if row:
            row["population"] = _jload(row.get("population"), {})
        return row

    def list_claims(self, workspace_id: Optional[int] = None, *, limit: int = 500,
                    status: Optional[str] = None, therapeutic_area_id: Optional[int] = None
                    ) -> List[Dict[str, Any]]:
        where, params = [], []
        if workspace_id is not None:
            where.append("workspace_id=?"); params.append(workspace_id)
        if status:
            where.append("status=?"); params.append(status)
        if therapeutic_area_id is not None:
            where.append("therapeutic_area_id=?"); params.append(therapeutic_area_id)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        rows = self.query(
            f"SELECT * FROM claims {clause} ORDER BY updated_at DESC LIMIT ?",
            params + [limit])
        for r in rows:
            r["population"] = _jload(r.get("population"), {})
        return rows

    def update_claim_state(self, claim_id: int, *, status: str, evidence_strength: str,
                          trend: str, version: int, verified_at: Optional[str] = None) -> None:
        self.execute(
            "UPDATE claims SET status=?, evidence_strength=?, trend=?, current_version=?, "
            "updated_at=?, last_verified_at=? WHERE id=?",
            (status, evidence_strength, trend, version, now_iso(),
             verified_at or now_iso(), claim_id))

    def add_claim_version(self, claim_id: int, version: int, *, status: str,
                         evidence_strength: str, best_level: Optional[int],
                         supporting: int, contradicting: int, neutral: int,
                         assessment: Any, summary: str, fingerprint: str) -> int:
        cur = self.execute(
            "INSERT INTO claim_versions(claim_id, version, status, evidence_strength, "
            "best_level, supporting_count, contradicting_count, neutral_count, assessment, "
            "summary, evidence_fingerprint, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (claim_id, version, status, evidence_strength, best_level, supporting,
             contradicting, neutral, _jdump(assessment), summary, fingerprint, now_iso()))
        return cur.lastrowid

    def latest_version(self, claim_id: int) -> Optional[Dict[str, Any]]:
        row = self.one(
            "SELECT * FROM claim_versions WHERE claim_id=? ORDER BY version DESC LIMIT 1",
            (claim_id,))
        if row:
            row["assessment"] = _jload(row.get("assessment"))
        return row

    def claim_timeline(self, claim_id: int) -> List[Dict[str, Any]]:
        rows = self.query(
            "SELECT * FROM claim_versions WHERE claim_id=? ORDER BY version ASC", (claim_id,))
        for r in rows:
            r["assessment"] = _jload(r.get("assessment"))
        return rows

    # -- studies & evidence -------------------------------------------------
    def upsert_study(self, *, dedup_key: str, source: str, pmid: Optional[str],
                    doi: Optional[str], title: str, abstract: str, journal: str,
                    year: Optional[int], authors: Any, publication_types: Any,
                    url: str, has_full_text: bool, extraction: Any) -> int:
        existing = self.one("SELECT id FROM studies WHERE dedup_key=?", (dedup_key,))
        if existing:
            # keep the record fresh (e.g. extraction improved) without losing first_seen_at
            self.execute(
                "UPDATE studies SET source=?, pmid=COALESCE(?,pmid), doi=COALESCE(?,doi), "
                "title=?, abstract=?, journal=?, year=?, authors=?, publication_types=?, "
                "url=?, has_full_text=?, extraction=? WHERE id=?",
                (source, pmid, doi, title, abstract, journal, year, _jdump(authors),
                 _jdump(publication_types), url, int(has_full_text), _jdump(extraction),
                 existing["id"]))
            return existing["id"]
        cur = self.execute(
            "INSERT INTO studies(dedup_key, source, pmid, doi, title, abstract, journal, "
            "year, authors, publication_types, url, has_full_text, extraction, first_seen_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (dedup_key, source, pmid, doi, title, abstract, journal, year, _jdump(authors),
             _jdump(publication_types), url, int(has_full_text), _jdump(extraction), now_iso()))
        return cur.lastrowid

    def add_evidence_item(self, claim_id: int, claim_version: int, study_id: int, *,
                         stance: str, stance_reason: str, disagreement_type: Optional[str],
                         relevance_score: float, grade_level: int, grade_label: str,
                         strength: str, effect: Any, population_match: Any) -> int:
        cur = self.execute(
            "INSERT OR REPLACE INTO evidence_items(claim_id, claim_version, study_id, stance, "
            "stance_reason, disagreement_type, relevance_score, grade_level, grade_label, "
            "strength, effect, population_match, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (claim_id, claim_version, study_id, stance, stance_reason, disagreement_type,
             relevance_score, grade_level, grade_label, strength, _jdump(effect),
             _jdump(population_match), now_iso()))
        return cur.lastrowid

    def evidence_for_version(self, claim_id: int, version: int) -> List[Dict[str, Any]]:
        rows = self.query(
            "SELECT e.*, s.dedup_key, s.title, s.pmid, s.doi, s.url, s.year, s.journal, "
            "s.source, s.abstract, s.has_full_text, s.extraction AS study_extraction "
            "FROM evidence_items e JOIN studies s ON s.id=e.study_id "
            "WHERE e.claim_id=? AND e.claim_version=? ORDER BY e.relevance_score DESC",
            (claim_id, version))
        for r in rows:
            r["effect"] = _jload(r.get("effect"))
            r["population_match"] = _jload(r.get("population_match"))
            r["study_extraction"] = _jload(r.get("study_extraction"))
        return rows

    # -- monitoring & change ------------------------------------------------
    def create_monitor(self, claim_id: int, *, frequency: str = "weekly",
                       conditions: Any = None, next_run_at: Optional[str] = None) -> int:
        cur = self.execute(
            "INSERT OR REPLACE INTO monitors(claim_id, frequency, conditions, active, "
            "created_at, next_run_at) VALUES (?,?,?,1,?,?)",
            (claim_id, frequency, _jdump(conditions or []), now_iso(), next_run_at))
        return cur.lastrowid

    def get_monitor(self, claim_id: int) -> Optional[Dict[str, Any]]:
        row = self.one("SELECT * FROM monitors WHERE claim_id=?", (claim_id,))
        if row:
            row["conditions"] = _jload(row.get("conditions"), [])
        return row

    def mark_monitor_run(self, claim_id: int, next_run_at: Optional[str]) -> None:
        self.execute("UPDATE monitors SET last_run_at=?, next_run_at=? WHERE claim_id=?",
                     (now_iso(), next_run_at, claim_id))

    def record_change_event(self, claim_id: int, *, from_version: Optional[int],
                           to_version: Optional[int], change_type: str, impact: str,
                           summary: str, detail: Any = None,
                           study_id: Optional[int] = None) -> int:
        cur = self.execute(
            "INSERT INTO change_events(claim_id, from_version, to_version, change_type, "
            "impact, summary, detail, study_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (claim_id, from_version, to_version, change_type, impact, summary,
             _jdump(detail), study_id, now_iso()))
        return cur.lastrowid

    def create_alert(self, claim_id: int, *, change_event_id: Optional[int],
                    monitor_id: Optional[int], level: str, title: str, body: str,
                    recommended_action: str) -> int:
        cur = self.execute(
            "INSERT INTO alerts(claim_id, change_event_id, monitor_id, level, title, body, "
            "recommended_action, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (claim_id, change_event_id, monitor_id, level, title, body,
             recommended_action, now_iso()))
        return cur.lastrowid

    def list_alerts(self, workspace_id: Optional[int] = None, *, status: Optional[str] = None,
                   limit: int = 100) -> List[Dict[str, Any]]:
        where, params = [], []
        if workspace_id is not None:
            where.append("c.workspace_id=?"); params.append(workspace_id)
        if status:
            where.append("a.status=?"); params.append(status)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        return self.query(
            f"SELECT a.*, c.text AS claim_text FROM alerts a JOIN claims c ON c.id=a.claim_id "
            f"{clause} ORDER BY a.created_at DESC LIMIT ?", params + [limit])

    def list_changes(self, workspace_id: Optional[int] = None, *, since: Optional[str] = None,
                    limit: int = 200) -> List[Dict[str, Any]]:
        where, params = [], []
        if workspace_id is not None:
            where.append("c.workspace_id=?"); params.append(workspace_id)
        if since:
            where.append("ce.created_at>=?"); params.append(since)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        rows = self.query(
            f"SELECT ce.*, c.text AS claim_text FROM change_events ce "
            f"JOIN claims c ON c.id=ce.claim_id {clause} "
            f"ORDER BY ce.created_at DESC LIMIT ?", params + [limit])
        for r in rows:
            r["detail"] = _jload(r.get("detail"))
        return rows

    # -- API keys -----------------------------------------------------------
    def create_api_key(self, org_id: Optional[int], name: str, *,
                      rate_limit_per_min: int = 60, scopes: Any = None) -> Dict[str, Any]:
        """Mint a key. Returns the plaintext ONCE; only the hash is stored."""
        import hashlib
        import secrets
        token = secrets.token_urlsafe(32)
        full = f"sk_live_{token}"
        prefix = full[:14]
        key_hash = hashlib.sha256(full.encode()).hexdigest()
        cur = self.execute(
            "INSERT INTO api_keys(org_id, name, prefix, key_hash, scopes, "
            "rate_limit_per_min, created_at) VALUES (?,?,?,?,?,?,?)",
            (org_id, name, prefix, key_hash, _jdump(scopes or ["verify", "search"]),
             rate_limit_per_min, now_iso()))
        return {"id": cur.lastrowid, "key": full, "prefix": prefix,
                "rate_limit_per_min": rate_limit_per_min}

    def find_api_key(self, presented: str) -> Optional[Dict[str, Any]]:
        import hashlib
        key_hash = hashlib.sha256(presented.encode()).hexdigest()
        row = self.one("SELECT * FROM api_keys WHERE key_hash=? AND active=1", (key_hash,))
        if row:
            row["scopes"] = _jload(row.get("scopes"), [])
        return row

    def revoke_api_key(self, key_id: int) -> None:
        self.execute("UPDATE api_keys SET active=0, revoked_at=? WHERE id=?",
                     (now_iso(), key_id))

    def touch_api_key(self, key_id: int) -> None:
        self.execute("UPDATE api_keys SET last_used_at=? WHERE id=?", (now_iso(), key_id))

    def log_usage(self, api_key_id: Optional[int], *, endpoint: str, method: str,
                 status_code: int, latency_ms: int, units: int = 1) -> None:
        self.execute(
            "INSERT INTO api_usage(api_key_id, ts, endpoint, method, status_code, "
            "latency_ms, units) VALUES (?,?,?,?,?,?,?)",
            (api_key_id, now_iso(), endpoint, method, status_code, latency_ms, units))

    def usage_count_since(self, api_key_id: int, since_iso: str) -> int:
        row = self.one(
            "SELECT COUNT(*) AS n FROM api_usage WHERE api_key_id=? AND ts>=?",
            (api_key_id, since_iso))
        return row["n"] if row else 0

    # -- demo requests ------------------------------------------------------
    def create_demo_request(self, *, name: str, email: str, organization: str,
                           role: str, company: str, use_case: str, source: str = "web"
                           ) -> int:
        cur = self.execute(
            "INSERT INTO demo_requests(name, email, organization, role, company, use_case, "
            "source, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (name, email, organization, role, company, use_case, source, now_iso()))
        return cur.lastrowid

    def mark_demo_delivered(self, demo_id: int, note: str) -> None:
        self.execute("UPDATE demo_requests SET delivered=1, delivery_note=? WHERE id=?",
                     (note, demo_id))

    # -- dashboard ----------------------------------------------------------
    def dashboard_stats(self, workspace_id: int, *, since: Optional[str] = None
                       ) -> Dict[str, Any]:
        """The numbers the Console leads with — all derived from real rows."""
        since = since or (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=7)
                          ).replace(microsecond=0).isoformat()
        total = self.one("SELECT COUNT(*) n FROM claims WHERE workspace_id=?",
                         (workspace_id,))["n"]

        def _count(change_type: str) -> int:
            r = self.one(
                "SELECT COUNT(DISTINCT ce.claim_id) n FROM change_events ce "
                "JOIN claims c ON c.id=ce.claim_id "
                "WHERE c.workspace_id=? AND ce.created_at>=? AND ce.change_type=?",
                (workspace_id, since, change_type))
            return r["n"] if r else 0

        strengthened = self.one(
            "SELECT COUNT(DISTINCT ce.claim_id) n FROM change_events ce "
            "JOIN claims c ON c.id=ce.claim_id WHERE c.workspace_id=? AND ce.created_at>=? "
            "AND ce.change_type='strength_change' AND json_extract(ce.detail,'$.direction')='up'",
            (workspace_id, since))["n"]
        weakened = self.one(
            "SELECT COUNT(DISTINCT ce.claim_id) n FROM change_events ce "
            "JOIN claims c ON c.id=ce.claim_id WHERE c.workspace_id=? AND ce.created_at>=? "
            "AND ce.change_type='strength_change' AND json_extract(ce.detail,'$.direction')='down'",
            (workspace_id, since))["n"]
        new_studies = self.one(
            "SELECT COUNT(*) n FROM change_events ce JOIN claims c ON c.id=ce.claim_id "
            "WHERE c.workspace_id=? AND ce.created_at>=? AND ce.change_type='new_study'",
            (workspace_id, since))["n"]
        by_status = {r["status"]: r["n"] for r in self.query(
            "SELECT status, COUNT(*) n FROM claims WHERE workspace_id=? GROUP BY status",
            (workspace_id,))}
        by_strength = {r["evidence_strength"]: r["n"] for r in self.query(
            "SELECT evidence_strength, COUNT(*) n FROM claims WHERE workspace_id=? "
            "GROUP BY evidence_strength", (workspace_id,))}
        open_alerts = self.one(
            "SELECT COUNT(*) n FROM alerts a JOIN claims c ON c.id=a.claim_id "
            "WHERE c.workspace_id=? AND a.status='new'", (workspace_id,))["n"]
        return {
            "claims_monitored": total,
            "strengthened": strengthened,
            "weakened": weakened,
            "newly_contradicted": _count("new_contradiction"),
            "new_studies": new_studies,
            "open_alerts": open_alerts,
            "by_status": by_status,
            "by_strength": by_strength,
            "since": since,
        }

    def therapeutic_area_activity(self, workspace_id: int, *, since: str) -> List[Dict[str, Any]]:
        return self.query(
            "SELECT ta.name AS area, COUNT(ce.id) AS changes "
            "FROM therapeutic_areas ta "
            "JOIN claims c ON c.therapeutic_area_id=ta.id "
            "LEFT JOIN change_events ce ON ce.claim_id=c.id AND ce.created_at>=? "
            "WHERE ta.workspace_id=? GROUP BY ta.id ORDER BY changes DESC",
            (since, workspace_id))


_DEFAULT: Optional[Database] = None


def get_db(path: Optional[str] = None) -> Database:
    """Process-wide default database (used by the server and CLI)."""
    global _DEFAULT
    if _DEFAULT is None or (path is not None and path != _DEFAULT.path):
        _DEFAULT = Database(path)
    return _DEFAULT
