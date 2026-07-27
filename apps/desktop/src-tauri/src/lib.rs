use serde::Serialize;

/// One corpus search result returned to the renderer. Mirrors the shape the
/// TypeScript data layer expects (see `src/data/corpus.ts`), so the frontend is
/// identical whether it reads the bundled JSON demo corpus or this database path.
#[derive(Serialize)]
pub struct CorpusSearchHit {
    pub criterion_id: String,
    pub policy_document_id: String,
    pub span_id: String,
    pub verbatim_quote: String,
    pub snippet: String,
}

/// Future full-text search over the on-disk corpus.
///
/// In production this queries the local SQLite database's **FTS5** index — the
/// schema defined in `@assent/local-db` (`packages/local-db/src/schema.sql`),
/// which the desktop app syncs and reads entirely offline. The real body opens
/// the WAL-mode database and runs something like:
///
/// ```sql
/// SELECT c.id, c.policy_document_id, c.span_id, c.verbatim_quote,
///        snippet(criteria_fts, 0, '[', ']', '…', 12) AS snippet
/// FROM criteria_fts
/// JOIN criteria c ON c.rowid = criteria_fts.rowid
/// WHERE criteria_fts MATCH ?1
/// ORDER BY rank
/// LIMIT ?2;
/// ```
///
/// returning verified criteria together with their span offsets so the renderer
/// can drive the citation highlight. The heavy query stays Rust-side; the webview
/// only ever receives already-verified rows.
#[tauri::command]
fn search_corpus(query: String, limit: Option<u32>) -> Result<Vec<CorpusSearchHit>, String> {
    // Stubbed for the demo build (no database is attached here). The signature and
    // wiring are real so the production implementation is a drop-in.
    let _ = (query, limit);
    Ok(Vec::new())
}

/// The shared entry point, called by both the desktop binary (`main.rs`) and the
/// mobile entry point. Registers the app's Tauri commands and runs the event loop.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![search_corpus])
        .run(tauri::generate_context!())
        .expect("error while running the Assent Desktop application");
}
