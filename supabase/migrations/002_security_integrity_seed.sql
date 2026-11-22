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
