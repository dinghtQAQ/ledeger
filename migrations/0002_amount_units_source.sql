PRAGMA foreign_keys = OFF;

CREATE TABLE entries_v2 (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'due_expense')),
	amount_units TEXT NOT NULL,
	occurred_at TEXT NOT NULL,
	due_at TEXT,
	due_status TEXT,
	category TEXT,
	note TEXT,
	is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
	reversal_of TEXT UNIQUE,
	reversed_at TEXT,
	version INTEGER NOT NULL DEFAULT 1,
	idempotency_key TEXT UNIQUE,
	idempotency_payload TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (reversal_of) REFERENCES entries_v2(id),
	CHECK (
		(type = 'due_expense' AND due_at IS NOT NULL AND due_status IN ('unpaid', 'paid', 'cancelled'))
		OR (type != 'due_expense' AND due_at IS NULL AND due_status IS NULL)
	)
);

INSERT INTO entries_v2 (
	id, type, amount_units, occurred_at, due_at, due_status, category, note,
	is_reversal, reversal_of, reversed_at, version, idempotency_key,
	idempotency_payload, created_at, updated_at
)
SELECT
	id, type, amount_units, occurred_at, due_at, due_status, category, note,
	is_reversal, reversal_of, reversed_at, version, idempotency_key,
	idempotency_payload, created_at, updated_at
FROM entries;

DROP TABLE entries;
ALTER TABLE entries_v2 RENAME TO entries;

CREATE INDEX IF NOT EXISTS idx_entries_occurred_at_id
	ON entries (occurred_at, id);
CREATE INDEX IF NOT EXISTS idx_entries_type
	ON entries (type);
CREATE INDEX IF NOT EXISTS idx_entries_category
	ON entries (category);

PRAGMA foreign_keys = ON;
