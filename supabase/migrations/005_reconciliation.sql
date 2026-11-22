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
