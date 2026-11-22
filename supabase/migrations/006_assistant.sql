-- InvoiceOS 006: demo assistant staged actions. Safe to re-run.
-- The assistant is a rule-based keyword engine (no external AI). It only STAGES a change as a Proposed row;
-- a person confirms it and the API then runs the normal handlers (transition tables and role rules still apply).

CREATE TABLE IF NOT EXISTS ai_action (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL REFERENCES businesses(id),
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    input_text TEXT NOT NULL DEFAULT '',
    intent TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'Proposed',
    result_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    decided_at TEXT NOT NULL DEFAULT ''
);

DO $$ BEGIN
  ALTER TABLE ai_action ADD CONSTRAINT ai_action_status_chk CHECK (status IN ('Proposed','Confirmed','Cancelled','Failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ai_action_org_created ON ai_action (org, created_at DESC);

ALTER TABLE ai_action ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_action FROM anon, authenticated;
