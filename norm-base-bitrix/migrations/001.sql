PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS documents (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 document_id INTEGER NOT NULL REFERENCES documents(id),
 original_name TEXT NOT NULL,
 stored_name TEXT NOT NULL UNIQUE,
 extension TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending_review','ocr_needed','ready')),
 extracted_text TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL DEFAULT '',
 source_date TEXT,
 effective_from TEXT,
 effective_to TEXT,
 created_at TEXT NOT NULL,
 created_by INTEGER NOT NULL,
 reviewed_at TEXT,
 reviewed_by INTEGER
);
CREATE TABLE IF NOT EXISTS provisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 version_id INTEGER NOT NULL REFERENCES versions(id),
 locator TEXT NOT NULL,
 body TEXT NOT NULL,
 effective_from TEXT NOT NULL,
 effective_to TEXT
);
CREATE INDEX IF NOT EXISTS ix_versions_document ON versions(document_id, id);
CREATE INDEX IF NOT EXISTS ix_provisions_dates ON provisions(effective_from, effective_to);
CREATE TABLE IF NOT EXISTS audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER NOT NULL,
 action TEXT NOT NULL,
 entity_id INTEGER NOT NULL,
 happened_at TEXT NOT NULL
);
