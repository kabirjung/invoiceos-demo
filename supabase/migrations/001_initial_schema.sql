-- InvoiceOS Demo - Initial Schema
-- Migrated from SQLite to Supabase (PostgreSQL)

-- Enable RLS
-- (Row Level Security can be enabled per table as needed)

CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    city TEXT DEFAULT '',
    gstin TEXT DEFAULT '',
    email TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    supplier TEXT NOT NULL,
    customer TEXT NOT NULL,
    supplier_gstin TEXT DEFAULT '',
    customer_gstin TEXT DEFAULT '',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    po_number TEXT DEFAULT '',
    description TEXT NOT NULL,
    qty REAL NOT NULL,
    rate REAL NOT NULL,
    tax REAL NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL,
    dispute_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
    id SERIAL PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    buyer TEXT NOT NULL,
    vendor TEXT NOT NULL,
    vendor_invoice_id TEXT NOT NULL,
    received_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    po_number TEXT DEFAULT '',
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'network',
    status TEXT NOT NULL DEFAULT 'Received',
    ocr_confidence REAL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bill_activity (
    id SERIAL PRIMARY KEY,
    bill_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    requester TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes matching the SQLite schema
CREATE INDEX IF NOT EXISTS idx_invoice_status_due ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_activity_invoice_created ON activity(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_buyer_status_due ON bills(buyer, status, due_date);
CREATE INDEX IF NOT EXISTS idx_bill_activity_bill_created ON bill_activity(bill_id, created_at DESC);

-- Seed data placeholder - insert via Supabase dashboard or seed script
