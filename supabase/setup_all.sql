-- InvoiceOS: full database setup. Paste into Supabase > SQL Editor > Run. Safe to re-run.

-- ===== migrations/001_initial_schema.sql =====
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

-- ===== migrations/002_security_integrity_seed.sql =====
-- InvoiceOS 002: lock down the tables, fix money types, add integrity, seed ISO-dated demo data.
-- Safe to re-run. Apply in the Supabase SQL editor or with `supabase db push`.

-- 1. Money and quantities: REAL is a 4-byte float and loses paise on large totals.
ALTER TABLE invoices
  ALTER COLUMN qty  TYPE NUMERIC(12,2) USING qty::numeric,
  ALTER COLUMN rate TYPE NUMERIC(14,2) USING rate::numeric,
  ALTER COLUMN tax  TYPE NUMERIC(5,2)  USING tax::numeric,
  ALTER COLUMN total TYPE NUMERIC(16,2) USING total::numeric;
ALTER TABLE bills
  ALTER COLUMN amount TYPE NUMERIC(16,2) USING amount::numeric,
  ALTER COLUMN ocr_confidence TYPE NUMERIC(4,3) USING ocr_confidence::numeric;

-- 2. Integrity. NOT VALID keeps any legacy rows; new writes are checked.
DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_supplier_fk FOREIGN KEY (supplier) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE invoices ADD CONSTRAINT invoices_customer_fk FOREIGN KEY (customer) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE bills ADD CONSTRAINT bills_buyer_fk FOREIGN KEY (buyer) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE bills ADD CONSTRAINT bills_vendor_fk FOREIGN KEY (vendor) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE connections ADD CONSTRAINT connections_requester_fk FOREIGN KEY (requester) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE connections ADD CONSTRAINT connections_target_fk FOREIGN KEY (target) REFERENCES businesses(id) NOT VALID;
  ALTER TABLE activity ADD CONSTRAINT activity_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE NOT VALID;
  ALTER TABLE comments ADD CONSTRAINT comments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE NOT VALID;
  ALTER TABLE bill_activity ADD CONSTRAINT bill_activity_bill_fk FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE invoices ADD CONSTRAINT invoices_checks CHECK (
    tax IN (0,5,12,18,28) AND qty > 0 AND total >= 0 AND due_date >= issue_date) NOT VALID;
  ALTER TABLE invoices ADD CONSTRAINT invoices_status_chk CHECK (status IN
    ('Draft','Sent','Viewed','Pending approval','Approved','Partially paid','Paid','Overdue','Dispute','Resolved','Rejected')) NOT VALID;
  ALTER TABLE bills ADD CONSTRAINT bills_status_chk CHECK (status IN
    ('Received','Needs approval','Approved','Rejected','Scheduled','Paid')) NOT VALID;
  ALTER TABLE connections ADD CONSTRAINT connections_status_chk CHECK (status IN
    ('Pending','Connected','Declined','Revoked')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_vendor_ref ON bills (buyer, vendor, lower(vendor_invoice_id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_pair ON connections (requester, target);
CREATE INDEX IF NOT EXISTS idx_comments_invoice ON comments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_connections_pair_status ON connections (requester, target, status);

-- 3. Security. Only the server (service-role key) may touch these tables.
--    RLS is enabled with no policies, and the public roles lose all table privileges.
ALTER TABLE businesses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity      ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 4. Demo data: fictional businesses and ISO dates relative to today. Re-running refreshes the dates.
WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts)
INSERT INTO businesses (id, name, kind, city, gstin, email, created_at)
SELECT v.*, t.ts FROM t, (VALUES
  ('northstar','Northstar Studio','supplier','Bengaluru','29AABCN1234A1Z5','accounts@northstar.example'),
  ('meridian','Meridian Retail Pvt Ltd','buyer','Mumbai','27AAMCM5678B2Z8','ap@meridian.example'),
  ('apex','Apex Industrial Supply','both','Pune','27AAAPA1111C1Z2','finance@apex.example'),
  ('trident','Trident Auto Parts','both','Nashik','27AABTT2222D1Z3','accounts@trident.example'),
  ('kaveri','Kaveri Foods Pvt Ltd','buyer','Bengaluru','29AAKCK3333E1Z4','ap@kaveri.example')
) AS v(id,name,kind,city,gstin,email)
ON CONFLICT (id) DO NOTHING;

WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts)
INSERT INTO connections (id, requester, target, status, scopes, created_at, updated_at)
SELECT v.id, v.a, v.b, 'Connected', '["exchange_invoices","share_payment_status"]', t.ts, t.ts
FROM t, (VALUES
  ('conn_northstar_meridian','northstar','meridian'),
  ('conn_northstar_apex','northstar','apex'),
  ('conn_northstar_trident','northstar','trident'),
  ('conn_northstar_kaveri','northstar','kaveri'),
  ('conn_apex_meridian','apex','meridian'),
  ('conn_trident_meridian','trident','meridian')
) AS v(id,a,b)
ON CONFLICT (id) DO NOTHING;

WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts),
d AS (SELECT * FROM (VALUES
  ('INV-2025-0842','northstar','meridian',-12, 18,'PO-MR-102','Brand strategy and campaign design',1, 210000,18,'Dispute','Deliverable scope query'),
  ('INV-2025-0841','northstar','apex',    -13, 17,'PO-AP-203','Website and product copywriting',1, 149322,18,'Paid',''),
  ('INV-2025-0839','northstar','trident', -40, -10,'PO-TR-044','Quarterly creative services',1, 71895,18,'Overdue',''),
  ('INV-2025-0838','northstar','meridian',-15, 15,'PO-MR-101','Retail launch campaign creative',1, 264000,18,'Dispute','Quantity mismatch'),
  ('INV-2025-0835','northstar','apex',    -9, 21,'PO-AP-199','Brand identity refresh',1, 105339,18,'Sent',''),
  ('INV-2025-0836','northstar','kaveri',  -6, 24,'PO-KV-310','Packaging illustration set',2, 38500,12,'Sent',''),
  ('INV-2025-0850','northstar','meridian',-2, 28,'PO-MR-115','Seasonal campaign photography',1, 96000,18,'Sent',''),
  ('INV-2025-0847','apex','meridian',     -5, 25,'PO-MR-008','Replacement pump set',4, 94000,18,'Pending approval','')
) AS x(id,supplier,customer,issue_off,due_off,po,descr,qty,rate,tax,status,reason))
INSERT INTO invoices (id,supplier,customer,supplier_gstin,customer_gstin,issue_date,due_date,po_number,
                      description,qty,rate,tax,total,status,dispute_reason,created_at,updated_at)
SELECT d.id,d.supplier,d.customer,s.gstin,c.gstin,
       to_char(current_date + d.issue_off,'YYYY-MM-DD'), to_char(current_date + d.due_off,'YYYY-MM-DD'),
       d.po,d.descr,d.qty,d.rate,d.tax,round(d.qty*d.rate*(1+d.tax/100.0),2),d.status,d.reason,t.ts,t.ts
FROM d, t, businesses s, businesses c
WHERE s.id=d.supplier AND c.id=d.customer
ON CONFLICT (id) DO UPDATE SET issue_date=EXCLUDED.issue_date, due_date=EXCLUDED.due_date;

INSERT INTO activity (invoice_id, actor, action, detail, created_at)
SELECT i.id, i.supplier, 'Invoice created', i.status, i.created_at FROM invoices i
WHERE i.id LIKE 'INV-2025-08%' AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.invoice_id = i.id);

WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts),
d AS (SELECT * FROM (VALUES
  ('BILL-4521','meridian','northstar','NS-2025-0192',-4,26,'MR-PO-880','Brand identity and campaign design',186000,'network','Needs approval',0.99),
  ('BILL-4518','meridian','apex','AP-2025-110',-5,25,'MR-PO-870','Packaging print run',94400,'upload','Received',0.96),
  ('BILL-4512','meridian','trident','TR-2025-044',-7,23,'MR-PO-852','Retail display fixtures',225000,'manual','Needs approval',0.93),
  ('BILL-4509','meridian','northstar','NS-2025-0184',-8,22,'MR-PO-841','Product photography',72000,'network','Approved',0.99)
) AS x(id,buyer,vendor,ref,recv_off,due_off,po,descr,amount,source,status,conf))
INSERT INTO bills (id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,amount,source,status,ocr_confidence,created_at)
SELECT d.id,d.buyer,d.vendor,d.ref,to_char(current_date + d.recv_off,'YYYY-MM-DD'),to_char(current_date + d.due_off,'YYYY-MM-DD'),
       d.po,d.descr,d.amount,d.source,d.status,d.conf,t.ts
FROM d, t
ON CONFLICT (id) DO UPDATE SET received_date=EXCLUDED.received_date, due_date=EXCLUDED.due_date;

INSERT INTO bill_activity (bill_id, actor, action, detail, created_at)
SELECT b.id, b.buyer, 'Bill received', 'Added to AP inbox · ' || b.source || ' entry', b.created_at FROM bills b
WHERE b.id LIKE 'BILL-45%' AND NOT EXISTS (SELECT 1 FROM bill_activity a WHERE a.bill_id = b.id);

-- ===== migrations/003_calendar.sql =====
-- InvoiceOS 003: staff, calendar (meetings) and assigned work (tasks with deadlines). Safe to re-run.
-- All people are fictional demo data. No invites or notifications are ever sent.

CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    role_key TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_role ON staff (org, role_key);

CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES businesses(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_date TEXT NOT NULL,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    attendees TEXT DEFAULT '[]',          -- JSON list of staff ids
    assignee_staff TEXT DEFAULT '',       -- staff id (tasks)
    created_by_staff TEXT NOT NULL REFERENCES staff(id),
    status TEXT NOT NULL,
    priority TEXT DEFAULT 'Normal',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

DO $$ BEGIN
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_kind_chk CHECK (kind IN ('meeting','task'));
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_status_chk CHECK (status IN
    ('Scheduled','Cancelled','Open','In progress','Done'));
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_priority_chk CHECK (priority IN ('Normal','High'));
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_task_chk CHECK (
    kind <> 'task' OR (assignee_staff <> '' AND due_date <> ''));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_calendar_org_date ON calendar_events (org, start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_assignee ON calendar_events (org, assignee_staff, status);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON staff, calendar_events FROM anon, authenticated;

-- Demo staff (fictional), one per internal demo role.
WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts)
INSERT INTO staff (id, org, name, role_key, title, created_at)
SELECT v.*, t.ts FROM t, (VALUES
  ('staff_arjun','northstar','Arjun Kulkarni','owner','Owner / Director'),
  ('staff_meera','northstar','Meera Nair','finance_manager','Finance Manager'),
  ('staff_priya','northstar','Priya Shah','ar','AR Accountant'),
  ('staff_ananya','northstar','Ananya Iyer','auditor','Auditor / CA'),
  ('staff_riya','meridian','Riya Menon','ap','AP Accountant'),
  ('staff_kavita','meridian','Kavita Rao','approver','Approver')
) AS v(id, org, name, role_key, title)
ON CONFLICT (id) DO NOTHING;

-- Meetings, dates relative to today. Re-running leaves existing rows untouched.
WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts)
INSERT INTO calendar_events (id, org, kind, title, description, start_date, start_time, end_time, due_date,
                             attendees, assignee_staff, created_by_staff, status, priority, created_at, updated_at)
SELECT v.id, v.org, 'meeting', v.title, v.descr, to_char(current_date + v.off, 'YYYY-MM-DD'), v.st, v.et, '',
       v.att, '', v.by, 'Scheduled', 'Normal', t.ts, t.ts
FROM t, (VALUES
  ('evt_seed_m1','northstar','Invoice policy review','Agreed payment terms and reminder cadence for the quarter.',-3,'14:00','14:45','["staff_arjun","staff_meera"]','staff_arjun'),
  ('evt_seed_m2','northstar','Query prep: Meridian disputes','Agree the reply on the scope and quantity queries before we respond.',0,'16:00','16:30','["staff_meera","staff_priya"]','staff_meera'),
  ('evt_seed_m3','northstar','Weekly receivables review','Walk through overdue and disputed invoices and who owns each follow-up.',1,'10:00','10:45','["staff_arjun","staff_meera","staff_priya"]','staff_meera'),
  ('evt_seed_m4','northstar','Month-end close sync','Cut-off, accruals and open items before the books close.',3,'15:00','16:00','["staff_ananya","staff_arjun","staff_meera","staff_priya"]','staff_arjun'),
  ('evt_seed_m5','northstar','Vendor review call: Trident Auto Parts','Discuss the overdue invoice and agree a payment date.',5,'11:30','12:15','["staff_arjun","staff_meera"]','staff_arjun'),
  ('evt_seed_m6','northstar','Audit walkthrough','Approval trail and status history sample for the auditor.',8,'11:00','12:00','["staff_ananya","staff_arjun","staff_meera"]','staff_arjun'),
  ('evt_seed_m7','meridian','Vendor payment run planning','Choose approved bills for the next payment run.',2,'11:00','11:30','["staff_kavita","staff_riya"]','staff_kavita'),
  ('evt_seed_m8','meridian','Vendor review call: Northstar Studio','Review open queries on shared invoices and upcoming deliverables.',4,'14:00','14:45','["staff_kavita","staff_riya"]','staff_kavita')
) AS v(id, org, title, descr, off, st, et, att, by)
ON CONFLICT (id) DO NOTHING;

-- Assigned work with deadlines: one overdue, one due today, one done, the rest upcoming.
WITH t AS (SELECT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS') AS ts)
INSERT INTO calendar_events (id, org, kind, title, description, start_date, start_time, end_time, due_date,
                             attendees, assignee_staff, created_by_staff, status, priority, created_at, updated_at)
SELECT v.id, v.org, 'task', v.title, v.descr, to_char(current_date + v.assigned, 'YYYY-MM-DD'), '', '',
       to_char(current_date + v.due, 'YYYY-MM-DD'), '[]', v.who, v.by, v.status, v.pri, t.ts, t.ts
FROM t, (VALUES
  ('evt_seed_t1','northstar','Chase overdue invoice INV-2025-0839','Trident Auto Parts is past due. Follow up and record a promised payment date.','staff_priya',-1,'In progress','High','staff_meera',-6),
  ('evt_seed_t2','northstar','Reply to Meridian''s scope query on INV-2025-0842','Draft the response for tomorrow''s receivables review.','staff_priya',0,'In progress','High','staff_meera',-2),
  ('evt_seed_t3','northstar','Update Kaveri buyer details','Confirm GSTIN and contact email on the connection.','staff_priya',-3,'Done','Normal','staff_meera',-8),
  ('evt_seed_t4','northstar','Reconcile last month''s receipts','Match recorded payments to shared invoices.','staff_priya',2,'Open','Normal','staff_meera',-1),
  ('evt_seed_t5','northstar','Draft reminder for INV-2025-0835','Prepare a gentle reminder for Apex Industrial Supply.','staff_priya',4,'Open','Normal','staff_arjun',0),
  ('evt_seed_t6','northstar','Review approval trail sample','Sample ten approved records and note any exceptions.','staff_ananya',6,'Open','Normal','staff_arjun',-2),
  ('evt_seed_t7','meridian','Confirm PO for BILL-4518','Packaging print run has no matching purchase order yet.','staff_riya',-2,'Open','High','staff_kavita',-5),
  ('evt_seed_t8','meridian','Match BILL-4512 to goods receipt','Check delivery against the purchase order before approval.','staff_riya',1,'Open','High','staff_kavita',-1),
  ('evt_seed_t9','meridian','Capture pending vendor bills','Enter bills received by email into the AP inbox.','staff_riya',3,'In progress','Normal','staff_kavita',-2),
  ('evt_seed_t10','meridian','Archive paid bill documents','File supporting documents for settled bills.','staff_riya',-1,'Done','Normal','staff_kavita',-6)
) AS v(id, org, title, descr, who, due, status, pri, by, assigned)
ON CONFLICT (id) DO NOTHING;

-- ===== migrations/004_business_features.sql =====
-- InvoiceOS 004: business features (notifications, collections, payment runs, cash-flow settings) + richer history.
-- Safe to re-run. Generated from the seed lists in api/_local.py (business_seed_rows); dates are relative to today.
-- Everything here is fictional demo data. Nothing sends email or moves money.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(16,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_date TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promised_date TEXT DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_date TEXT DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS scheduled_date TEXT DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS discount_by TEXT DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_run_id TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES businesses(id),
    audience TEXT DEFAULT '',            -- '' = every internal role of the org, else comma-separated role keys
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link_page TEXT DEFAULT '',
    link_id TEXT DEFAULT '',
    read_by TEXT DEFAULT '[]',           -- JSON list of role keys that have read it
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications (org, created_at);

CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    org TEXT NOT NULL REFERENCES businesses(id),
    tone TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Sent (demo)',
    created_by_staff TEXT DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON reminders (invoice_id);

CREATE TABLE IF NOT EXISTS payment_runs (
    id TEXT PRIMARY KEY,
    buyer TEXT NOT NULL REFERENCES businesses(id),
    strategy TEXT NOT NULL,
    status TEXT NOT NULL,
    pay_date TEXT NOT NULL,
    total NUMERIC(16,2) NOT NULL,
    discount NUMERIC(16,2) DEFAULT 0,
    bill_count INTEGER NOT NULL,
    created_by_staff TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_run_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES payment_runs(id) ON DELETE CASCADE,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    amount NUMERIC(16,2) NOT NULL,
    discount NUMERIC(16,2) DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_items_run ON payment_run_items (run_id);

CREATE TABLE IF NOT EXISTS org_settings (
    org TEXT PRIMARY KEY REFERENCES businesses(id),
    opening_balance NUMERIC(16,2) DEFAULT 0,
    approval_threshold NUMERIC(16,2) DEFAULT 0,
    updated_at TEXT NOT NULL
);

DO $$ BEGIN
  ALTER TABLE reminders ADD CONSTRAINT reminders_tone_chk CHECK (tone IN ('gentle','firm','final','upcoming'));
  ALTER TABLE payment_runs ADD CONSTRAINT payment_runs_status_chk CHECK (status IN ('Scheduled','Paid'));
  ALTER TABLE payment_runs ADD CONSTRAINT payment_runs_strategy_chk CHECK (strategy IN ('by_due','preserve_cash','early_discount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notifications, reminders, payment_runs, payment_run_items, org_settings FROM anon, authenticated;


-- invoices: 22 demo rows
INSERT INTO invoices (id, supplier, customer, supplier_gstin, customer_gstin, issue_date, due_date, po_number, description, qty, rate, tax, total, status, dispute_reason, amount_paid, paid_date, promised_date, created_at, updated_at) VALUES
  ('INV-2025-0780', 'northstar', 'trident', '29AABCN1234A1Z5', '27AABTT2222D1Z3', to_char(current_date + -125,'YYYY-MM-DD'), to_char(current_date + -95,'YYYY-MM-DD'), 'PO-TR-019', 'Annual brand retainer: final quarter', 1, 118000, 18, 139240.0, 'Overdue', '', 0.0, '', '', to_char(current_date + -125,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -124,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0790', 'northstar', 'kaveri', '29AABCN1234A1Z5', '29AAKCK3333E1Z4', to_char(current_date + -100,'YYYY-MM-DD'), to_char(current_date + -70,'YYYY-MM-DD'), 'PO-KV-288', 'Festive packaging artwork', 1, 64500, 12, 72240.0, 'Overdue', '', 0.0, '', to_char(current_date + -2,'YYYY-MM-DD'), to_char(current_date + -100,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -99,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0801', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -88,'YYYY-MM-DD'), to_char(current_date + -58,'YYYY-MM-DD'), 'PO-MR-071', 'Store window campaign design', 1, 182000, 18, 214760.0, 'Paid', '', 214760.0, to_char(current_date + -50,'YYYY-MM-DD'), '', to_char(current_date + -88,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -50,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0805', 'northstar', 'apex', '29AABCN1234A1Z5', '27AAAPA1111C1Z2', to_char(current_date + -85,'YYYY-MM-DD'), to_char(current_date + -55,'YYYY-MM-DD'), 'PO-AP-160', 'Product catalogue layout', 1, 76000, 18, 89680.0, 'Paid', '', 89680.0, to_char(current_date + -57,'YYYY-MM-DD'), '', to_char(current_date + -85,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -57,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0808', 'northstar', 'kaveri', '29AABCN1234A1Z5', '29AAKCK3333E1Z4', to_char(current_date + -80,'YYYY-MM-DD'), to_char(current_date + -50,'YYYY-MM-DD'), 'PO-KV-270', 'Label redesign: spice range', 3, 21500, 12, 72240.0, 'Paid', '', 72240.0, to_char(current_date + -52,'YYYY-MM-DD'), '', to_char(current_date + -80,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -52,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0810', 'northstar', 'trident', '29AABCN1234A1Z5', '27AABTT2222D1Z3', to_char(current_date + -78,'YYYY-MM-DD'), to_char(current_date + -48,'YYYY-MM-DD'), 'PO-TR-031', 'Dealer brochure series', 1, 92000, 18, 108560.0, 'Paid', '', 108560.0, to_char(current_date + -30,'YYYY-MM-DD'), '', to_char(current_date + -78,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -30,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0812', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -72,'YYYY-MM-DD'), to_char(current_date + -42,'YYYY-MM-DD'), 'PO-MR-079', 'Loyalty programme creative', 1, 148000, 18, 174640.0, 'Paid', '', 174640.0, to_char(current_date + -35,'YYYY-MM-DD'), '', to_char(current_date + -72,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -35,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0815', 'northstar', 'apex', '29AABCN1234A1Z5', '27AAAPA1111C1Z2', to_char(current_date + -66,'YYYY-MM-DD'), to_char(current_date + -36,'YYYY-MM-DD'), 'PO-AP-171', 'Trade show booth graphics', 1, 58500, 18, 69030.0, 'Paid', '', 69030.0, to_char(current_date + -37,'YYYY-MM-DD'), '', to_char(current_date + -66,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -37,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0818', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -60,'YYYY-MM-DD'), to_char(current_date + -30,'YYYY-MM-DD'), 'PO-MR-088', 'Monsoon sale campaign', 1, 226000, 18, 266680.0, 'Paid', '', 266680.0, to_char(current_date + -31,'YYYY-MM-DD'), '', to_char(current_date + -60,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -31,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0820', 'northstar', 'kaveri', '29AABCN1234A1Z5', '29AAKCK3333E1Z4', to_char(current_date + -55,'YYYY-MM-DD'), to_char(current_date + -25,'YYYY-MM-DD'), 'PO-KV-279', 'Recipe card illustrations', 4, 9800, 12, 43904.0, 'Paid', '', 43904.0, to_char(current_date + -25,'YYYY-MM-DD'), '', to_char(current_date + -55,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -25,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0822', 'northstar', 'trident', '29AABCN1234A1Z5', '27AABTT2222D1Z3', to_char(current_date + -52,'YYYY-MM-DD'), to_char(current_date + -22,'YYYY-MM-DD'), 'PO-TR-038', 'Service manual design', 1, 134000, 18, 158120.0, 'Partially paid', '', 79060.0, '', to_char(current_date + 6,'YYYY-MM-DD'), to_char(current_date + -52,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -12,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0824', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -48,'YYYY-MM-DD'), to_char(current_date + -18,'YYYY-MM-DD'), 'PO-MR-094', 'In-store signage system', 1, 118500, 18, 139830.0, 'Approved', '', 0.0, '', '', to_char(current_date + -48,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -47,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0826', 'northstar', 'apex', '29AABCN1234A1Z5', '27AAAPA1111C1Z2', to_char(current_date + -45,'YYYY-MM-DD'), to_char(current_date + -15,'YYYY-MM-DD'), 'PO-AP-180', 'Safety poster series', 1, 42000, 18, 49560.0, 'Paid', '', 49560.0, to_char(current_date + -16,'YYYY-MM-DD'), '', to_char(current_date + -45,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -16,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0828', 'northstar', 'kaveri', '29AABCN1234A1Z5', '29AAKCK3333E1Z4', to_char(current_date + -70,'YYYY-MM-DD'), to_char(current_date + -40,'YYYY-MM-DD'), 'PO-KV-295', 'Social media content pack', 1, 55000, 18, 64900.0, 'Overdue', '', 0.0, '', '', to_char(current_date + -70,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -69,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0830', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -35,'YYYY-MM-DD'), to_char(current_date + -5,'YYYY-MM-DD'), 'PO-MR-098', 'Customer survey report design', 1, 68000, 18, 80240.0, 'Viewed', '', 0.0, '', '', to_char(current_date + -35,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -34,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0832', 'northstar', 'apex', '29AABCN1234A1Z5', '27AAAPA1111C1Z2', to_char(current_date + -30,'YYYY-MM-DD'), to_char(current_date + 0,'YYYY-MM-DD'), 'PO-AP-188', 'Annual report design', 1, 165000, 18, 194700.0, 'Approved', '', 0.0, '', '', to_char(current_date + -30,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -29,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0834', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -25,'YYYY-MM-DD'), to_char(current_date + 5,'YYYY-MM-DD'), 'PO-MR-104', 'Festive gifting catalogue', 1, 138000, 18, 162840.0, 'Approved', '', 0.0, '', '', to_char(current_date + -25,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -24,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0845', 'northstar', 'trident', '29AABCN1234A1Z5', '27AABTT2222D1Z3', to_char(current_date + -20,'YYYY-MM-DD'), to_char(current_date + 10,'YYYY-MM-DD'), 'PO-TR-047', 'Website banner refresh', 1, 48000, 18, 56640.0, 'Sent', '', 0.0, '', '', to_char(current_date + -20,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -19,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0852', 'northstar', 'kaveri', '29AABCN1234A1Z5', '29AAKCK3333E1Z4', to_char(current_date + -10,'YYYY-MM-DD'), to_char(current_date + 35,'YYYY-MM-DD'), 'PO-KV-318', 'New product launch kit', 1, 112000, 18, 132160.0, 'Sent', '', 0.0, '', '', to_char(current_date + -10,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -9,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0855', 'northstar', 'meridian', '29AABCN1234A1Z5', '27AAMCM5678B2Z8', to_char(current_date + -3,'YYYY-MM-DD'), to_char(current_date + 45,'YYYY-MM-DD'), 'PO-MR-120', 'Spring collection lookbook', 1, 245000, 18, 289100.0, 'Sent', '', 0.0, '', '', to_char(current_date + -3,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + -2,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0858', 'northstar', 'apex', '29AABCN1234A1Z5', '27AAAPA1111C1Z2', to_char(current_date + -1,'YYYY-MM-DD'), to_char(current_date + 55,'YYYY-MM-DD'), 'PO-AP-205', 'Brand guidelines retainer', 1, 180000, 18, 212400.0, 'Sent', '', 0.0, '', '', to_char(current_date + -1,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + 0,'YYYY-MM-DD') || 'T12:00:00'),
  ('INV-2025-0860', 'northstar', 'trident', '29AABCN1234A1Z5', '27AABTT2222D1Z3', to_char(current_date + 0,'YYYY-MM-DD'), to_char(current_date + 60,'YYYY-MM-DD'), 'PO-TR-052', 'Quarterly creative services (next quarter)', 1, 96000, 18, 113280.0, 'Sent', '', 0.0, '', '', to_char(current_date + 0,'YYYY-MM-DD') || 'T09:30:00', to_char(current_date + 0,'YYYY-MM-DD') || 'T12:00:00')
ON CONFLICT (id) DO NOTHING;

-- bills: 23 demo rows
INSERT INTO bills (id, buyer, vendor, vendor_invoice_id, received_date, due_date, po_number, description, amount, source, status, ocr_confidence, created_at, paid_date, scheduled_date, discount_pct, discount_by, payment_run_id) VALUES
  ('BILL-4470', 'meridian', 'northstar', 'INV-2025-0801', to_char(current_date + -88,'YYYY-MM-DD'), to_char(current_date + -58,'YYYY-MM-DD'), 'PO-MR-071', 'Store window campaign design', 214760.0, 'network', 'Paid', 1.0, to_char(current_date + -88,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -50,'YYYY-MM-DD'), '', 0, '', ''),
  ('BILL-4478', 'meridian', 'northstar', 'INV-2025-0812', to_char(current_date + -72,'YYYY-MM-DD'), to_char(current_date + -42,'YYYY-MM-DD'), 'PO-MR-079', 'Loyalty programme creative', 174640.0, 'network', 'Paid', 1.0, to_char(current_date + -72,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -35,'YYYY-MM-DD'), '', 0, '', ''),
  ('BILL-4486', 'meridian', 'northstar', 'INV-2025-0818', to_char(current_date + -60,'YYYY-MM-DD'), to_char(current_date + -30,'YYYY-MM-DD'), 'PO-MR-088', 'Monsoon sale campaign', 266680.0, 'network', 'Paid', 1.0, to_char(current_date + -60,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -31,'YYYY-MM-DD'), to_char(current_date + -31,'YYYY-MM-DD'), 0, '', 'PR-0006'),
  ('BILL-4490', 'meridian', 'apex', 'AP-2025-088', to_char(current_date + -70,'YYYY-MM-DD'), to_char(current_date + -38,'YYYY-MM-DD'), 'MR-PO-790', 'Shelf-edge printing', 88500, 'upload', 'Paid', 0.97, to_char(current_date + -70,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -40,'YYYY-MM-DD'), '', 0, '', ''),
  ('BILL-4494', 'meridian', 'trident', 'TR-2025-031', to_char(current_date + -54,'YYYY-MM-DD'), to_char(current_date + -24,'YYYY-MM-DD'), 'MR-PO-806', 'Delivery van fit-out parts', 146000, 'manual', 'Paid', 0.94, to_char(current_date + -54,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -31,'YYYY-MM-DD'), to_char(current_date + -31,'YYYY-MM-DD'), 0, '', 'PR-0006'),
  ('BILL-4526', 'meridian', 'northstar', 'INV-2025-0824', to_char(current_date + -48,'YYYY-MM-DD'), to_char(current_date + -18,'YYYY-MM-DD'), 'PO-MR-094', 'In-store signage system', 139830.0, 'network', 'Approved', 1.0, to_char(current_date + -48,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-4530', 'meridian', 'northstar', 'INV-2025-0834', to_char(current_date + -25,'YYYY-MM-DD'), to_char(current_date + 5,'YYYY-MM-DD'), 'PO-MR-104', 'Festive gifting catalogue', 162840.0, 'network', 'Approved', 1.0, to_char(current_date + -25,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-4532', 'meridian', 'apex', 'AP-2025-118', to_char(current_date + -12,'YYYY-MM-DD'), to_char(current_date + 9,'YYYY-MM-DD'), 'MR-PO-884', 'Point-of-sale stands', 132000, 'upload', 'Approved', 0.97, to_char(current_date + -12,'YYYY-MM-DD') || 'T10:00:00', '', '', 2, to_char(current_date + 2,'YYYY-MM-DD'), ''),
  ('BILL-4534', 'meridian', 'trident', 'TR-2025-052', to_char(current_date + -8,'YYYY-MM-DD'), to_char(current_date + 16,'YYYY-MM-DD'), 'MR-PO-889', 'Warehouse racking spares', 74800, 'manual', 'Approved', 0.95, to_char(current_date + -8,'YYYY-MM-DD') || 'T10:00:00', '', '', 1.5, to_char(current_date + 4,'YYYY-MM-DD'), ''),
  ('BILL-4536', 'meridian', 'apex', 'AP-2025-121', to_char(current_date + -4,'YYYY-MM-DD'), to_char(current_date + 34,'YYYY-MM-DD'), 'MR-PO-893', 'Seasonal packaging stock', 208000, 'upload', 'Approved', 0.98, to_char(current_date + -4,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-4538', 'meridian', 'trident', 'TR-2025-055', to_char(current_date + -15,'YYYY-MM-DD'), to_char(current_date + 12,'YYYY-MM-DD'), 'MR-PO-876', 'Display lighting kits', 96500, 'manual', 'Scheduled', 0.96, to_char(current_date + -15,'YYYY-MM-DD') || 'T10:00:00', '', to_char(current_date + 3,'YYYY-MM-DD'), 0, '', 'PR-0007'),
  ('BILL-4540', 'meridian', 'northstar', 'INV-2025-0830', to_char(current_date + -35,'YYYY-MM-DD'), to_char(current_date + -5,'YYYY-MM-DD'), 'PO-MR-098', 'Customer survey report design', 80240.0, 'network', 'Received', 1.0, to_char(current_date + -35,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-4542', 'meridian', 'northstar', 'INV-2025-0855', to_char(current_date + -3,'YYYY-MM-DD'), to_char(current_date + 45,'YYYY-MM-DD'), 'PO-MR-120', 'Spring collection lookbook', 289100.0, 'network', 'Received', 1.0, to_char(current_date + -3,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-4544', 'meridian', 'northstar', 'INV-2025-0850', to_char(current_date + -2,'YYYY-MM-DD'), to_char(current_date + 28,'YYYY-MM-DD'), 'PO-MR-115', 'Seasonal campaign photography', 113280.0, 'network', 'Received', 1.0, to_char(current_date + -2,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3099', 'northstar', 'apex', 'AP-NS-290', to_char(current_date + -50,'YYYY-MM-DD'), to_char(current_date + -20,'YYYY-MM-DD'), 'NS-PO-410', 'Print proofs: monsoon campaign', 46000, 'upload', 'Paid', 0.96, to_char(current_date + -50,'YYYY-MM-DD') || 'T10:00:00', to_char(current_date + -21,'YYYY-MM-DD'), '', 0, '', ''),
  ('BILL-3101', 'northstar', 'apex', 'AP-NS-301', to_char(current_date + -14,'YYYY-MM-DD'), to_char(current_date + 6,'YYYY-MM-DD'), 'NS-PO-422', 'Studio lighting rental', 84000, 'upload', 'Approved', 0.97, to_char(current_date + -14,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3102', 'northstar', 'trident', 'TR-NS-112', to_char(current_date + -10,'YYYY-MM-DD'), to_char(current_date + 13,'YYYY-MM-DD'), 'NS-PO-425', 'Exhibition stand fabrication', 165000, 'manual', 'Approved', 0.93, to_char(current_date + -10,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3103', 'northstar', 'apex', 'AP-NS-305', to_char(current_date + -6,'YYYY-MM-DD'), to_char(current_date + 24,'YYYY-MM-DD'), 'NS-PO-431', 'Print production: Meridian launch', 212000, 'upload', 'Received', 0.95, to_char(current_date + -6,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3104', 'northstar', 'trident', 'TR-NS-118', to_char(current_date + -3,'YYYY-MM-DD'), to_char(current_date + 38,'YYYY-MM-DD'), 'NS-PO-436', 'Event logistics and transport', 96000, 'manual', 'Needs approval', 0.92, to_char(current_date + -3,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3106', 'northstar', 'trident', 'TR-NS-120', to_char(current_date + -9,'YYYY-MM-DD'), to_char(current_date + 2,'YYYY-MM-DD'), 'NS-PO-433', 'Production crew and camera equipment', 340000, 'manual', 'Approved', 0.94, to_char(current_date + -9,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3107', 'northstar', 'apex', 'AP-NS-311', to_char(current_date + -5,'YYYY-MM-DD'), to_char(current_date + 9,'YYYY-MM-DD'), 'NS-PO-438', 'Annual design software licences', 295000, 'upload', 'Approved', 0.98, to_char(current_date + -5,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3108', 'northstar', 'apex', 'AP-NS-314', to_char(current_date + -2,'YYYY-MM-DD'), to_char(current_date + 20,'YYYY-MM-DD'), 'NS-PO-441', 'Studio fit-out: second instalment', 420000, 'upload', 'Needs approval', 0.95, to_char(current_date + -2,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
  ('BILL-3105', 'northstar', 'apex', 'AP-NS-309', to_char(current_date + -1,'YYYY-MM-DD'), to_char(current_date + 52,'YYYY-MM-DD'), 'NS-PO-440', 'Packaging prototypes', 58000, 'upload', 'Received', 0.96, to_char(current_date + -1,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', '')
ON CONFLICT (id) DO NOTHING;

-- payment_runs: 2 demo rows
INSERT INTO payment_runs (id, buyer, strategy, status, pay_date, total, discount, bill_count, created_by_staff, created_at, updated_at) VALUES
  ('PR-0006', 'meridian', 'by_due', 'Paid', to_char(current_date + -31,'YYYY-MM-DD'), 412680.0, 0, 2, 'staff_riya', to_char(current_date + -33,'YYYY-MM-DD') || 'T17:20:00', to_char(current_date + -31,'YYYY-MM-DD') || 'T17:30:00'),
  ('PR-0007', 'meridian', 'preserve_cash', 'Scheduled', to_char(current_date + 3,'YYYY-MM-DD'), 96500, 0, 1, 'staff_riya', to_char(current_date + -1,'YYYY-MM-DD') || 'T17:20:00', to_char(current_date + 0,'YYYY-MM-DD') || 'T17:30:00')
ON CONFLICT (id) DO NOTHING;

-- payment_run_items: 3 demo rows
INSERT INTO payment_run_items (id, run_id, bill_id, amount, discount, created_at) VALUES
  ('pri_PR-0006_BILL-4486', 'PR-0006', 'BILL-4486', 266680.0, 0, to_char(current_date + -33,'YYYY-MM-DD') || 'T17:20:00'),
  ('pri_PR-0006_BILL-4494', 'PR-0006', 'BILL-4494', 146000, 0, to_char(current_date + -33,'YYYY-MM-DD') || 'T17:20:00'),
  ('pri_PR-0007_BILL-4538', 'PR-0007', 'BILL-4538', 96500, 0, to_char(current_date + -1,'YYYY-MM-DD') || 'T17:20:00')
ON CONFLICT (id) DO NOTHING;

-- reminders: 5 demo rows
INSERT INTO reminders (id, invoice_id, org, tone, body, status, created_by_staff, created_at) VALUES
  ('rem_seed_1', 'INV-2025-0780', 'northstar', 'firm', 'Hello Trident Auto Parts team, INV-2025-0780 for ₹139,240 is now 65 days past due. Please arrange payment or tell us what is holding it up this week.', 'Sent (demo)', 'staff_priya', to_char(current_date + -30,'YYYY-MM-DD') || 'T10:40:00'),
  ('rem_seed_2', 'INV-2025-0790', 'northstar', 'gentle', 'Hi Kaveri Foods team, a friendly note that INV-2025-0790 for ₹72,240 was due on to_char(current_date + -70,''YYYY-MM-DD''). Could you share an expected payment date? Thank you.', 'Sent (demo)', 'staff_priya', to_char(current_date + -14,'YYYY-MM-DD') || 'T10:40:00'),
  ('rem_seed_3', 'INV-2025-0839', 'northstar', 'gentle', 'Hi Trident Auto Parts team, a friendly note that INV-2025-0839 for ₹84,836 was due on to_char(current_date + -10,''YYYY-MM-DD''). Could you share an expected payment date? Thank you.', 'Sent (demo)', 'staff_priya', to_char(current_date + -6,'YYYY-MM-DD') || 'T10:40:00'),
  ('rem_seed_4', 'INV-2025-0780', 'northstar', 'final', 'Dear Trident Auto Parts team, INV-2025-0780 for ₹139,240 is 86 days overdue despite earlier reminders. Please settle it within 7 days so we can keep your account in good standing.', 'Sent (demo)', 'staff_meera', to_char(current_date + -9,'YYYY-MM-DD') || 'T10:40:00'),
  ('rem_seed_5', 'INV-2025-0828', 'northstar', 'firm', 'Hello Kaveri Foods team, INV-2025-0828 for ₹64,900 is now 37 days past due. Please arrange payment or tell us what is holding it up this week.', 'Sent (demo)', 'staff_priya', to_char(current_date + -3,'YYYY-MM-DD') || 'T10:40:00')
ON CONFLICT (id) DO NOTHING;

-- notifications: 11 demo rows
INSERT INTO notifications (id, org, audience, kind, title, body, link_page, link_id, read_by, created_at) VALUES
  ('ntf_seed_01', 'northstar', '', 'payment', 'Apex Industrial Supply paid INV-2025-0841', 'Payment recorded on the shared invoice (demo).', 'detail', 'INV-2025-0841', '["owner", "finance_manager"]', to_char(current_date + -3,'YYYY-MM-DD') || 'T11:20:00'),
  ('ntf_seed_02', 'northstar', '', 'dispute', 'Meridian Retail raised a query', 'INV-2025-0842 · Deliverable scope query', 'detail', 'INV-2025-0842', '["owner"]', to_char(current_date + -2,'YYYY-MM-DD') || 'T15:05:00'),
  ('ntf_seed_03', 'northstar', '', 'promise', 'Promise to pay missed', 'Kaveri Foods promised INV-2025-0790 two days ago.', 'collections', 'INV-2025-0790', '[]', to_char(current_date + -1,'YYYY-MM-DD') || 'T09:00:00'),
  ('ntf_seed_04', 'northstar', '', 'view', 'Kaveri Foods viewed INV-2025-0836', 'The buyer opened the shared invoice.', 'detail', 'INV-2025-0836', '[]', to_char(current_date + -1,'YYYY-MM-DD') || 'T16:40:00'),
  ('ntf_seed_05', 'northstar', 'ar', 'task', 'New work assigned to you', 'Draft reminder for INV-2025-0835 · from Arjun Kulkarni', 'calendar', '', '[]', to_char(current_date + 0,'YYYY-MM-DD') || 'T09:10:00'),
  ('ntf_seed_06', 'northstar', '', 'comment', 'Meridian Retail replied on INV-2025-0838', 'Quantity mismatch query on the shared invoice.', 'detail', 'INV-2025-0838', '[]', to_char(current_date + 0,'YYYY-MM-DD') || 'T10:30:00'),
  ('ntf_seed_07', 'meridian', 'approver', 'approval', 'BILL-4521 needs your approval', 'Northstar Studio · ₹1,86,000', 'bills', 'BILL-4521', '[]', to_char(current_date + -4,'YYYY-MM-DD') || 'T12:00:00'),
  ('ntf_seed_08', 'meridian', '', 'reminder', 'Northstar Studio sent a payment reminder', 'INV-2025-0824 is past due (demo reminder, nothing was emailed).', 'bills', 'BILL-4526', '["approver"]', to_char(current_date + -2,'YYYY-MM-DD') || 'T10:00:00'),
  ('ntf_seed_09', 'meridian', '', 'invoice', 'New invoice from Northstar Studio', 'INV-2025-0855 · Spring collection lookbook', 'bills', 'BILL-4542', '["ap"]', to_char(current_date + -3,'YYYY-MM-DD') || 'T14:15:00'),
  ('ntf_seed_10', 'meridian', '', 'payment_run', 'Payment run PR-0007 scheduled', '1 bill · ₹96,500 · simulated, no money moves.', 'paymentRun', 'PR-0007', '[]', to_char(current_date + -1,'YYYY-MM-DD') || 'T17:30:00'),
  ('ntf_seed_11', 'meridian', 'ap', 'task', 'New work assigned to you', 'Match BILL-4512 to goods receipt · from Kavita Rao', 'calendar', '', '[]', to_char(current_date + -1,'YYYY-MM-DD') || 'T09:45:00')
ON CONFLICT (id) DO NOTHING;

-- org_settings: 2 demo rows
INSERT INTO org_settings (org, opening_balance, approval_threshold, updated_at) VALUES
  ('northstar', 525000, 0, to_char(current_date + 0,'YYYY-MM-DD') || 'T08:00:00'),
  ('meridian', 1850000, 150000, to_char(current_date + 0,'YYYY-MM-DD') || 'T08:00:00')
ON CONFLICT (org) DO NOTHING;

-- activity: 77 history rows, skipped when the same event is already recorded
INSERT INTO activity (invoice_id, actor, action, detail, created_at)
SELECT v.invoice_id, v.actor, v.action, v.detail, v.created_at FROM (VALUES
  ('INV-2025-0780', 'northstar', 'Invoice sent', 'Trident Auto Parts', to_char(current_date + -125,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0780', 'trident', 'Viewed', 'Opened the shared invoice', to_char(current_date + -124,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0780', 'northstar', 'Overdue', 'Marked overdue after the due date', to_char(current_date + -94,'YYYY-MM-DD') || 'T09:00:00'),
  ('INV-2025-0790', 'northstar', 'Invoice sent', 'Kaveri Foods', to_char(current_date + -100,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0790', 'kaveri', 'Viewed', 'Opened the shared invoice', to_char(current_date + -99,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0790', 'northstar', 'Overdue', 'Marked overdue after the due date', to_char(current_date + -69,'YYYY-MM-DD') || 'T09:00:00'),
  ('INV-2025-0801', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -88,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0801', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -87,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0801', 'meridian', 'Approved', 'Status updated', to_char(current_date + -85,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0801', 'meridian', 'Paid', 'Payment recorded (demo)', to_char(current_date + -50,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0805', 'northstar', 'Invoice sent', 'Apex Industrial Supply', to_char(current_date + -85,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0805', 'apex', 'Viewed', 'Opened the shared invoice', to_char(current_date + -84,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0805', 'apex', 'Approved', 'Status updated', to_char(current_date + -82,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0805', 'apex', 'Paid', 'Payment recorded (demo)', to_char(current_date + -57,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0808', 'northstar', 'Invoice sent', 'Kaveri Foods', to_char(current_date + -80,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0808', 'kaveri', 'Viewed', 'Opened the shared invoice', to_char(current_date + -79,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0808', 'kaveri', 'Approved', 'Status updated', to_char(current_date + -77,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0808', 'kaveri', 'Paid', 'Payment recorded (demo)', to_char(current_date + -52,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0810', 'northstar', 'Invoice sent', 'Trident Auto Parts', to_char(current_date + -78,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0810', 'trident', 'Viewed', 'Opened the shared invoice', to_char(current_date + -77,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0810', 'trident', 'Approved', 'Status updated', to_char(current_date + -75,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0810', 'trident', 'Paid', 'Payment recorded (demo)', to_char(current_date + -30,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0812', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -72,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0812', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -71,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0812', 'meridian', 'Dispute', 'Line item query raised by the buyer', to_char(current_date + -68,'YYYY-MM-DD') || 'T15:00:00'),
  ('INV-2025-0812', 'northstar', 'Resolved', 'Revised scope note shared', to_char(current_date + -63,'YYYY-MM-DD') || 'T10:00:00'),
  ('INV-2025-0812', 'meridian', 'Approved', 'Status updated', to_char(current_date + -67,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0812', 'meridian', 'Paid', 'Payment recorded (demo)', to_char(current_date + -35,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0815', 'northstar', 'Invoice sent', 'Apex Industrial Supply', to_char(current_date + -66,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0815', 'apex', 'Viewed', 'Opened the shared invoice', to_char(current_date + -65,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0815', 'apex', 'Approved', 'Status updated', to_char(current_date + -63,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0815', 'apex', 'Paid', 'Payment recorded (demo)', to_char(current_date + -37,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0818', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -60,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0818', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -59,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0818', 'meridian', 'Approved', 'Status updated', to_char(current_date + -57,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0818', 'meridian', 'Paid', 'Payment recorded (demo)', to_char(current_date + -31,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0820', 'northstar', 'Invoice sent', 'Kaveri Foods', to_char(current_date + -55,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0820', 'kaveri', 'Viewed', 'Opened the shared invoice', to_char(current_date + -54,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0820', 'kaveri', 'Approved', 'Status updated', to_char(current_date + -52,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0820', 'kaveri', 'Paid', 'Payment recorded (demo)', to_char(current_date + -25,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0822', 'northstar', 'Invoice sent', 'Trident Auto Parts', to_char(current_date + -52,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0822', 'trident', 'Viewed', 'Opened the shared invoice', to_char(current_date + -51,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0822', 'trident', 'Approved', 'Status updated', to_char(current_date + -49,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0822', 'trident', 'Partially paid', '₹79,060 recorded (demo)', to_char(current_date + -12,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0824', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -48,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0824', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -47,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0824', 'meridian', 'Approved', 'Status updated', to_char(current_date + -45,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0826', 'northstar', 'Invoice sent', 'Apex Industrial Supply', to_char(current_date + -45,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0826', 'apex', 'Viewed', 'Opened the shared invoice', to_char(current_date + -44,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0826', 'apex', 'Approved', 'Status updated', to_char(current_date + -42,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0826', 'apex', 'Paid', 'Payment recorded (demo)', to_char(current_date + -16,'YYYY-MM-DD') || 'T16:00:00'),
  ('INV-2025-0828', 'northstar', 'Invoice sent', 'Kaveri Foods', to_char(current_date + -70,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0828', 'kaveri', 'Viewed', 'Opened the shared invoice', to_char(current_date + -69,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0828', 'kaveri', 'Dispute', 'Line item query raised by the buyer', to_char(current_date + -66,'YYYY-MM-DD') || 'T15:00:00'),
  ('INV-2025-0828', 'northstar', 'Resolved', 'Revised scope note shared', to_char(current_date + -61,'YYYY-MM-DD') || 'T10:00:00'),
  ('INV-2025-0828', 'northstar', 'Overdue', 'Marked overdue after the due date', to_char(current_date + -39,'YYYY-MM-DD') || 'T09:00:00'),
  ('INV-2025-0830', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -35,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0830', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -34,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0832', 'northstar', 'Invoice sent', 'Apex Industrial Supply', to_char(current_date + -30,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0832', 'apex', 'Viewed', 'Opened the shared invoice', to_char(current_date + -29,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0832', 'apex', 'Approved', 'Status updated', to_char(current_date + -27,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0834', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -25,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0834', 'meridian', 'Viewed', 'Opened the shared invoice', to_char(current_date + -24,'YYYY-MM-DD') || 'T11:00:00'),
  ('INV-2025-0834', 'meridian', 'Approved', 'Status updated', to_char(current_date + -22,'YYYY-MM-DD') || 'T12:30:00'),
  ('INV-2025-0845', 'northstar', 'Invoice sent', 'Trident Auto Parts', to_char(current_date + -20,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0852', 'northstar', 'Invoice sent', 'Kaveri Foods', to_char(current_date + -10,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0855', 'northstar', 'Invoice sent', 'Meridian Retail', to_char(current_date + -3,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0858', 'northstar', 'Invoice sent', 'Apex Industrial Supply', to_char(current_date + -1,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0860', 'northstar', 'Invoice sent', 'Trident Auto Parts', to_char(current_date + 0,'YYYY-MM-DD') || 'T09:30:00'),
  ('INV-2025-0780', 'northstar', 'Reminder sent (demo)', 'Firm reminder · no email was sent', to_char(current_date + -30,'YYYY-MM-DD') || 'T10:40:00'),
  ('INV-2025-0790', 'northstar', 'Reminder sent (demo)', 'Gentle reminder · no email was sent', to_char(current_date + -14,'YYYY-MM-DD') || 'T10:40:00'),
  ('INV-2025-0839', 'northstar', 'Reminder sent (demo)', 'Gentle reminder · no email was sent', to_char(current_date + -6,'YYYY-MM-DD') || 'T10:40:00'),
  ('INV-2025-0780', 'northstar', 'Reminder sent (demo)', 'Final reminder · no email was sent', to_char(current_date + -9,'YYYY-MM-DD') || 'T10:40:00'),
  ('INV-2025-0828', 'northstar', 'Reminder sent (demo)', 'Firm reminder · no email was sent', to_char(current_date + -3,'YYYY-MM-DD') || 'T10:40:00'),
  ('INV-2025-0839', 'northstar', 'Promise to pay recorded', 'Customer promised payment by to_char(current_date + 3,''YYYY-MM-DD'')', to_char(current_date + -4,'YYYY-MM-DD') || 'T12:10:00'),
  ('INV-2025-0822', 'northstar', 'Promise to pay recorded', 'Customer promised payment by to_char(current_date + 6,''YYYY-MM-DD'')', to_char(current_date + -4,'YYYY-MM-DD') || 'T12:10:00'),
  ('INV-2025-0790', 'northstar', 'Promise to pay recorded', 'Customer promised payment by to_char(current_date + -2,''YYYY-MM-DD'')', to_char(current_date + -6,'YYYY-MM-DD') || 'T12:10:00')
) AS v(invoice_id, actor, action, detail, created_at)
WHERE NOT EXISTS (SELECT 1 FROM activity a WHERE a.invoice_id = v.invoice_id AND a.action = v.action AND a.detail = v.detail);

-- bill_activity: 67 history rows, skipped when the same event is already recorded
INSERT INTO bill_activity (bill_id, actor, action, detail, created_at)
SELECT v.bill_id, v.actor, v.action, v.detail, v.created_at FROM (VALUES
  ('BILL-4470', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -88,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4470', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -87,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4470', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -86,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4470', 'meridian', 'Bill status changed', 'Approved → Paid', to_char(current_date + -50,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4478', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -72,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4478', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -71,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4478', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -70,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4478', 'meridian', 'Bill status changed', 'Approved → Paid', to_char(current_date + -35,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4486', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -60,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4486', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -59,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4486', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -58,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4486', 'meridian', 'Bill status changed', 'Approved → Scheduled', to_char(current_date + -57,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4486', 'meridian', 'Bill status changed', 'Scheduled → Paid', to_char(current_date + -31,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4490', 'meridian', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -70,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4490', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -69,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4490', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -68,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4490', 'meridian', 'Bill status changed', 'Approved → Paid', to_char(current_date + -40,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4494', 'meridian', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -54,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4494', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -53,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4494', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -52,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4494', 'meridian', 'Bill status changed', 'Approved → Scheduled', to_char(current_date + -51,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4494', 'meridian', 'Bill status changed', 'Scheduled → Paid', to_char(current_date + -31,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4526', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -48,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4526', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -47,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4526', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -46,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4530', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -25,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4530', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -24,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4530', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -23,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4532', 'meridian', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -12,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4532', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -11,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4532', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -10,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4534', 'meridian', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -8,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4534', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -7,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4534', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -6,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4536', 'meridian', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -4,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4536', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -3,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4536', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -2,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4538', 'meridian', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -15,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4538', 'meridian', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -14,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4538', 'meridian', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -13,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4538', 'meridian', 'Bill status changed', 'Approved → Scheduled', to_char(current_date + -12,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4540', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -35,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4542', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -3,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4544', 'meridian', 'Bill received', 'Added to AP inbox · network entry', to_char(current_date + -2,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3099', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -50,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3099', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -49,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3099', 'northstar', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -48,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3099', 'northstar', 'Bill status changed', 'Approved → Paid', to_char(current_date + -21,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3101', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -14,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3101', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -13,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3101', 'northstar', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -12,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3102', 'northstar', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -10,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3102', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -9,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3102', 'northstar', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -8,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3103', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -6,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3104', 'northstar', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -3,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3104', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -2,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3106', 'northstar', 'Bill received', 'Added to AP inbox · manual entry', to_char(current_date + -9,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3106', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -8,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3106', 'northstar', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -7,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3107', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -5,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3107', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -4,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3107', 'northstar', 'Bill status changed', 'Needs approval → Approved', to_char(current_date + -3,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3108', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -2,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3108', 'northstar', 'Bill status changed', 'Received → Needs approval', to_char(current_date + -1,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-3105', 'northstar', 'Bill received', 'Added to AP inbox · upload entry', to_char(current_date + -1,'YYYY-MM-DD') || 'T13:00:00'),
  ('BILL-4538', 'meridian', 'Added to payment run', 'PR-0007 · pays on to_char(current_date + 3,''YYYY-MM-DD'') (demo)', to_char(current_date + -1,'YYYY-MM-DD') || 'T17:20:00')
) AS v(bill_id, actor, action, detail, created_at)
WHERE NOT EXISTS (SELECT 1 FROM bill_activity a WHERE a.bill_id = v.bill_id AND a.action = v.action AND a.detail = v.detail);

-- Existing seeded records gain the new fields.
UPDATE invoices SET promised_date = to_char(current_date + 3,'YYYY-MM-DD') WHERE id = 'INV-2025-0839' AND coalesce(promised_date,'') = '';
UPDATE invoices SET promised_date = to_char(current_date + 6,'YYYY-MM-DD') WHERE id = 'INV-2025-0822' AND coalesce(promised_date,'') = '';
UPDATE invoices SET promised_date = to_char(current_date + -2,'YYYY-MM-DD') WHERE id = 'INV-2025-0790' AND coalesce(promised_date,'') = '';
UPDATE invoices SET paid_date = to_char(current_date + -3,'YYYY-MM-DD'), amount_paid = total WHERE id = 'INV-2025-0841' AND status = 'Paid' AND coalesce(paid_date,'') = '';
INSERT INTO activity (invoice_id, actor, action, detail, created_at) SELECT 'INV-2025-0841', 'apex', 'Paid', 'Payment recorded (demo)', to_char(current_date + -3,'YYYY-MM-DD') || 'T11:20:00' WHERE NOT EXISTS (SELECT 1 FROM activity WHERE invoice_id = 'INV-2025-0841' AND action = 'Paid');

-- ===== migrations/005_reconciliation.sql =====
-- InvoiceOS 005: bank reconciliation (demo). Safe to re-run.
-- Bank lines are simulated: there is no real bank connection. A confirmed match marks the invoice or bill Paid
-- through the normal status rules in the API; this table keeps the audit record of which statement line did it.

CREATE TABLE IF NOT EXISTS bank_reconciliations (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES businesses(id),
    line_date TEXT NOT NULL,
    line_desc TEXT NOT NULL DEFAULT '',
    amount NUMERIC(14,2) NOT NULL,
    direction TEXT NOT NULL,
    matched_type TEXT NOT NULL,
    matched_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Matched',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

DO $$ BEGIN
  ALTER TABLE bank_reconciliations ADD CONSTRAINT recon_amount_chk CHECK (amount > 0);
  ALTER TABLE bank_reconciliations ADD CONSTRAINT recon_direction_chk CHECK (direction IN ('credit','debit'));
  ALTER TABLE bank_reconciliations ADD CONSTRAINT recon_type_chk CHECK (matched_type IN ('invoice','bill'));
  ALTER TABLE bank_reconciliations ADD CONSTRAINT recon_status_chk CHECK (status IN ('Matched','Skipped'));
  ALTER TABLE bank_reconciliations ADD CONSTRAINT recon_pair_chk CHECK (
    (direction = 'credit' AND matched_type = 'invoice') OR (direction = 'debit' AND matched_type = 'bill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One confirmed match per invoice/bill: a double confirm cannot create a second record.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_match ON bank_reconciliations (org, matched_type, matched_id) WHERE status = 'Matched';
CREATE INDEX IF NOT EXISTS idx_recon_org_created ON bank_reconciliations (org, created_at DESC);

ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bank_reconciliations FROM anon, authenticated;
