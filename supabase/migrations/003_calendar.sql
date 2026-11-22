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
