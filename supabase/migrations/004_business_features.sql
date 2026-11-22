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
  ('BILL-4544', 'meridian', 'northstar', 'INV-2025-0850', to_char(current_date + -2,'YYYY-MM-DD'), to_char(current_date + 28,'YYYY-MM-DD'), 'PO-MR-115', 'Seasonal campaign photography', NULL, 'network', 'Received', 1.0, to_char(current_date + -2,'YYYY-MM-DD') || 'T10:00:00', '', '', 0, '', ''),
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
