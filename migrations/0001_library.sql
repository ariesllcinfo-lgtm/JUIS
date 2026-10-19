CREATE TABLE IF NOT EXISTS library_items (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('paper','book')), description TEXT NOT NULL DEFAULT '',
 published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1)),
 byte_size INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS library_chunks (
 item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL, data BLOB NOT NULL,
 PRIMARY KEY(item_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS library_loans (
 item_id TEXT PRIMARY KEY REFERENCES library_items(id),
 loan_id TEXT NOT NULL UNIQUE, borrower TEXT NOT NULL,
 borrowed_at INTEGER NOT NULL, due_at INTEGER NOT NULL,
 CHECK(due_at = borrowed_at + 604800)
);
CREATE INDEX IF NOT EXISTS library_loans_borrower ON library_loans(borrower);
