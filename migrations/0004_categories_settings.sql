CREATE TABLE IF NOT EXISTS coarse_categories (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE
);

INSERT OR IGNORE INTO coarse_categories (id, name) VALUES
	(1, '住房'),
	(2, '餐饮'),
	(3, '交通'),
	(4, '公用'),
	(5, '健康'),
	(6, '娱乐'),
	(7, '投资');

CREATE TABLE IF NOT EXISTS fine_categories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	coarse_category_id INTEGER NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0,
	is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
	FOREIGN KEY (coarse_category_id) REFERENCES coarse_categories(id)
);

CREATE INDEX IF NOT EXISTS idx_fine_categories_parent_order
	ON fine_categories (coarse_category_id, sort_order, id);

CREATE TABLE IF NOT EXISTS ledger_settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	payday_day INTEGER NOT NULL DEFAULT 20 CHECK (payday_day BETWEEN 1 AND 28),
	updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO ledger_settings (id, payday_day, updated_at)
VALUES (1, 20, CURRENT_TIMESTAMP);

ALTER TABLE entries ADD COLUMN category_id INTEGER;
ALTER TABLE entries ADD COLUMN subcategory_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_entries_category_id
	ON entries (category_id);
CREATE INDEX IF NOT EXISTS idx_entries_subcategory_id
	ON entries (subcategory_id);
