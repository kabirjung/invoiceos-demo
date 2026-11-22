"""Local SQLite backend with the same interface as _core.SB (select/one/insert/update).

Used when INVOICEOS_LOCAL=1 (server.py sets it unless Supabase env vars are present).
It understands only the PostgREST filter shapes that _core produces: `col=eq.value`
and `or=(a.eq."x",and(b.eq."y",c.eq."z"))`.
"""
import datetime
import json
import os
import re
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(os.environ.get("INVOICEOS_DB", Path(__file__).resolve().parent.parent / "invoiceos.sqlite3"))
_init_lock = threading.Lock()
_initialised = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
  city TEXT DEFAULT '', gstin TEXT DEFAULT '', email TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, supplier TEXT NOT NULL, customer TEXT NOT NULL,
  supplier_gstin TEXT DEFAULT '', customer_gstin TEXT DEFAULT '', issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
  po_number TEXT DEFAULT '', description TEXT NOT NULL, qty NUMERIC NOT NULL, rate NUMERIC NOT NULL,
  tax NUMERIC NOT NULL, total NUMERIC NOT NULL, status TEXT NOT NULL, dispute_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL,
  actor TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bills (id TEXT PRIMARY KEY, buyer TEXT NOT NULL, vendor TEXT NOT NULL,
  vendor_invoice_id TEXT NOT NULL, received_date TEXT NOT NULL, due_date TEXT NOT NULL, po_number TEXT DEFAULT '',
  description TEXT NOT NULL, amount NUMERIC NOT NULL, source TEXT NOT NULL DEFAULT 'network',
  status TEXT NOT NULL DEFAULT 'Received', ocr_confidence NUMERIC DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bill_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, requester TEXT NOT NULL, target TEXT NOT NULL,
  status TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, org TEXT NOT NULL, name TEXT NOT NULL,
  role_key TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_role ON staff(org, role_key);
CREATE TABLE IF NOT EXISTS calendar_events (id TEXT PRIMARY KEY, org TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT DEFAULT '', start_date TEXT NOT NULL, start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '', due_date TEXT DEFAULT '', attendees TEXT DEFAULT '[]', assignee_staff TEXT DEFAULT '',
  created_by_staff TEXT NOT NULL, status TEXT NOT NULL, priority TEXT DEFAULT 'Normal',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conn_pair ON connections(requester, target);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_ref ON bills(buyer, vendor, lower(vendor_invoice_id));
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, org TEXT NOT NULL, audience TEXT DEFAULT '',
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT DEFAULT '', link_page TEXT DEFAULT '', link_id TEXT DEFAULT '',
  read_by TEXT DEFAULT '[]', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, org TEXT NOT NULL,
  tone TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Sent (demo)', created_by_staff TEXT DEFAULT '',
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_runs (id TEXT PRIMARY KEY, buyer TEXT NOT NULL, strategy TEXT NOT NULL,
  status TEXT NOT NULL, pay_date TEXT NOT NULL, total NUMERIC NOT NULL, discount NUMERIC DEFAULT 0,
  bill_count INTEGER NOT NULL, created_by_staff TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_run_items (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, bill_id TEXT NOT NULL,
  amount NUMERIC NOT NULL, discount NUMERIC DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS org_settings (org TEXT PRIMARY KEY, opening_balance NUMERIC DEFAULT 0,
  approval_threshold NUMERIC DEFAULT 0, updated_at TEXT NOT NULL);
-- RECONCILIATION
CREATE TABLE IF NOT EXISTS bank_reconciliations (id TEXT PRIMARY KEY, org TEXT NOT NULL, line_date TEXT NOT NULL,
  line_desc TEXT NOT NULL DEFAULT '', amount NUMERIC NOT NULL CHECK (amount > 0), direction TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  matched_type TEXT NOT NULL CHECK (matched_type IN ('invoice','bill')), matched_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Matched' CHECK (status IN ('Matched','Skipped')), created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_match ON bank_reconciliations(org, matched_type, matched_id) WHERE status='Matched';
-- END RECONCILIATION
-- ASSISTANT
CREATE TABLE IF NOT EXISTS ai_action (id TEXT PRIMARY KEY, org TEXT NOT NULL, actor TEXT NOT NULL, role TEXT NOT NULL,
  input_text TEXT NOT NULL DEFAULT '', intent TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed','Confirmed','Cancelled','Failed')),
  result_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_ai_action_org_created ON ai_action(org, created_at);
-- END ASSISTANT
"""
# Columns added after the first release; _migrate() adds them to older local databases.
ADDED_COLUMNS = {
    "invoices": [("amount_paid", "NUMERIC DEFAULT 0"), ("paid_date", "TEXT DEFAULT ''"), ("promised_date", "TEXT DEFAULT ''")],
    "bills": [("paid_date", "TEXT DEFAULT ''"), ("scheduled_date", "TEXT DEFAULT ''"), ("discount_pct", "NUMERIC DEFAULT 0"),
              ("discount_by", "TEXT DEFAULT ''"), ("payment_run_id", "TEXT DEFAULT ''")],
}
TABLES = {"businesses", "invoices", "activity", "comments", "bills", "bill_activity", "connections", "calendar_events", "staff",
          "notifications", "reminders", "payment_runs", "payment_run_items", "org_settings", "bank_reconciliations", "ai_action"}
COLUMN_RE = re.compile(r"[a-z_]+")


def _split_top(s):
    parts, depth, quoted, esc, cur = [], 0, False, False, []
    for ch in s:
        if esc:
            esc = False
        elif ch == "\\" and quoted:
            esc = True
        elif ch == '"':
            quoted = not quoted
        elif not quoted and ch == "(":
            depth += 1
        elif not quoted and ch == ")":
            depth -= 1
        elif not quoted and depth == 0 and ch == ",":
            parts.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    parts.append("".join(cur))
    return parts


def _unquote(v):
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return re.sub(r"\\(.)", r"\1", v[1:-1])
    return v


def _group(s, params):
    inner = s.strip()
    if inner.startswith("(") and inner.endswith(")"):
        inner = inner[1:-1]
    clauses = []
    for item in _split_top(inner):
        item = item.strip()
        if item.startswith("and(") and item.endswith(")"):
            sub = [_group("(" + p + ")", params) for p in _split_top(item[4:-1])]
            clauses.append("(" + " AND ".join(sub) + ")")
        else:
            col, op, val = item.split(".", 2)
            if not COLUMN_RE.fullmatch(col) or op != "eq":
                raise ValueError("unsupported filter")
            clauses.append(f"{col} = ?")
            params.append(_unquote(val))
    return "(" + " OR ".join(clauses) + ")" if len(clauses) > 1 else clauses[0]


def _where(filters):
    clauses, params = [], []
    for key, value in (filters or {}).items():
        if key == "or":
            clauses.append(_group(value, params))
        else:
            if not COLUMN_RE.fullmatch(key) or not value.startswith("eq."):
                raise ValueError("unsupported filter")
            clauses.append(f"{key} = ?")
            params.append(value[3:])
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _connect():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _stamp():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _seed(con):
    if con.execute("SELECT 1 FROM businesses LIMIT 1").fetchone():
        return
    ts = _stamp()
    today = datetime.date.today()
    day = lambda off: (today + datetime.timedelta(days=off)).isoformat()
    biz = [
        ("northstar", "Northstar Studio", "supplier", "Bengaluru", "29AABCN1234A1Z5", "accounts@northstar.example"),
        ("meridian", "Meridian Retail Pvt Ltd", "buyer", "Mumbai", "27AAMCM5678B2Z8", "ap@meridian.example"),
        ("apex", "Apex Industrial Supply", "both", "Pune", "27AAAPA1111C1Z2", "finance@apex.example"),
        ("trident", "Trident Auto Parts", "both", "Nashik", "27AABTT2222D1Z3", "accounts@trident.example"),
        ("kaveri", "Kaveri Foods Pvt Ltd", "buyer", "Bengaluru", "29AAKCK3333E1Z4", "ap@kaveri.example"),
    ]
    gst = {b[0]: b[4] for b in biz}
    con.executemany("INSERT INTO businesses VALUES (?,?,?,?,?,?,?)", [b + (ts,) for b in biz])
    scopes = json.dumps(["exchange_invoices", "share_payment_status"])
    pairs = [("northstar", "meridian"), ("northstar", "apex"), ("northstar", "trident"),
             ("northstar", "kaveri"), ("apex", "meridian"), ("trident", "meridian")]
    con.executemany("INSERT INTO connections VALUES (?,?,?,?,?,?,?)",
                    [(f"conn_{a}_{b}", a, b, "Connected", scopes, ts, ts) for a, b in pairs])
    invoices = [
        ("INV-2025-0842", "northstar", "meridian", -12, 18, "PO-MR-102", "Brand strategy and campaign design", 1, 210000, 18, "Dispute", "Deliverable scope query"),
        ("INV-2025-0841", "northstar", "apex", -13, 17, "PO-AP-203", "Website and product copywriting", 1, 149322, 18, "Paid", ""),
        ("INV-2025-0839", "northstar", "trident", -40, -10, "PO-TR-044", "Quarterly creative services", 1, 71895, 18, "Overdue", ""),
        ("INV-2025-0838", "northstar", "meridian", -15, 15, "PO-MR-101", "Retail launch campaign creative", 1, 264000, 18, "Dispute", "Quantity mismatch"),
        ("INV-2025-0835", "northstar", "apex", -9, 21, "PO-AP-199", "Brand identity refresh", 1, 105339, 18, "Sent", ""),
        ("INV-2025-0836", "northstar", "kaveri", -6, 24, "PO-KV-310", "Packaging illustration set", 2, 38500, 12, "Sent", ""),
        ("INV-2025-0850", "northstar", "meridian", -2, 28, "PO-MR-115", "Seasonal campaign photography", 1, 96000, 18, "Sent", ""),
        ("INV-2025-0847", "apex", "meridian", -5, 25, "PO-MR-008", "Replacement pump set", 4, 94000, 18, "Pending approval", ""),
    ]
    for iid, sup, cus, io, do, po, desc, qty, rate, tax, status, reason in invoices:
        total = round(qty * rate * (1 + tax / 100), 2)
        con.execute("INSERT INTO invoices (id,supplier,customer,supplier_gstin,customer_gstin,issue_date,due_date,po_number,"
                    "description,qty,rate,tax,total,status,dispute_reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (iid, sup, cus, gst[sup], gst[cus], day(io), day(do), po, desc, qty, rate, tax, total, status, reason, ts, ts))
        con.execute("INSERT INTO activity (invoice_id,actor,action,detail,created_at) VALUES (?,?,?,?,?)",
                    (iid, sup, "Invoice created", status, ts))
    bills = [
        ("BILL-4521", "meridian", "northstar", "NS-2025-0192", -4, 26, "MR-PO-880", "Brand identity and campaign design", 186000, "network", "Needs approval", 0.99),
        ("BILL-4518", "meridian", "apex", "AP-2025-110", -5, 25, "MR-PO-870", "Packaging print run", 94400, "upload", "Received", 0.96),
        ("BILL-4512", "meridian", "trident", "TR-2025-044", -7, 23, "MR-PO-852", "Retail display fixtures", 225000, "manual", "Needs approval", 0.93),
        ("BILL-4509", "meridian", "northstar", "NS-2025-0184", -8, 22, "MR-PO-841", "Product photography", 72000, "network", "Approved", 0.99),
    ]
    for bid, buyer, vendor, ref, ro, do, po, desc, amt, src, status, conf in bills:
        con.execute("INSERT INTO bills (id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,"
                    "amount,source,status,ocr_confidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (bid, buyer, vendor, ref, day(ro), day(do), po, desc, amt, src, status, conf, ts))
        con.execute("INSERT INTO bill_activity (bill_id,actor,action,detail,created_at) VALUES (?,?,?,?,?)",
                    (bid, buyer, "Bill received", f"Added to AP inbox · {src} entry", ts))


STAFF = [  # id, org, name, role_key, title (fictional people)
    ("staff_arjun", "northstar", "Arjun Kulkarni", "owner", "Owner / Director"),
    ("staff_meera", "northstar", "Meera Nair", "finance_manager", "Finance Manager"),
    ("staff_priya", "northstar", "Priya Shah", "ar", "AR Accountant"),
    ("staff_ananya", "northstar", "Ananya Iyer", "auditor", "Auditor / CA"),
    ("staff_riya", "meridian", "Riya Menon", "ap", "AP Accountant"),
    ("staff_kavita", "meridian", "Kavita Rao", "approver", "Approver"),
]


def _seed_calendar(con):
    ts = _stamp()
    if not con.execute("SELECT 1 FROM staff LIMIT 1").fetchone():
        con.executemany("INSERT INTO staff VALUES (?,?,?,?,?,?)", [r + (ts,) for r in STAFF])
    if con.execute("SELECT 1 FROM calendar_events LIMIT 1").fetchone():
        return
    today = datetime.date.today()
    day = lambda off: (today + datetime.timedelta(days=off)).isoformat()
    A, M, P, N, R, K = "staff_arjun", "staff_meera", "staff_priya", "staff_ananya", "staff_riya", "staff_kavita"
    meetings = [  # org, title, description, offset, start, end, attendees, creator
        ("northstar", "Invoice policy review", "Agreed payment terms and reminder cadence for the quarter.", -3, "14:00", "14:45", [A, M], A),
        ("northstar", "Query prep: Meridian disputes", "Agree the reply on the scope and quantity queries before we respond.", 0, "16:00", "16:30", [M, P], M),
        ("northstar", "Weekly receivables review", "Walk through overdue and disputed invoices and who owns each follow-up.", 1, "10:00", "10:45", [A, M, P], M),
        ("northstar", "Month-end close sync", "Cut-off, accruals and open items before the books close.", 3, "15:00", "16:00", [A, M, P, N], A),
        ("northstar", "Vendor review call: Trident Auto Parts", "Discuss the overdue invoice and agree a payment date.", 5, "11:30", "12:15", [A, M], A),
        ("northstar", "Audit walkthrough", "Approval trail and status history sample for the auditor.", 8, "11:00", "12:00", [A, M, N], A),
        ("meridian", "Vendor payment run planning", "Choose approved bills for the next payment run.", 2, "11:00", "11:30", [K, R], K),
        ("meridian", "Vendor review call: Northstar Studio", "Review open queries on shared invoices and upcoming deliverables.", 4, "14:00", "14:45", [K, R], K),
    ]
    cols = "(id,org,kind,title,description,start_date,start_time,end_time,due_date,attendees,assignee_staff,created_by_staff,status,priority,created_at,updated_at)"
    for i, (org, title, desc, off, st, et, att, by) in enumerate(meetings, 1):
        con.execute(f"INSERT INTO calendar_events {cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"evt_seed_m{i}", org, "meeting", title, desc, day(off), st, et, "", json.dumps(sorted(att)), "", by, "Scheduled", "Normal", ts, ts))
    tasks = [  # org, title, desc, assignee, due offset, status, priority, creator, assigned offset
        ("northstar", "Chase overdue invoice INV-2025-0839", "Trident Auto Parts is past due. Follow up and record a promised payment date.", P, -1, "In progress", "High", M, -6),
        ("northstar", "Reply to Meridian's scope query on INV-2025-0842", "Draft the response for tomorrow's receivables review.", P, 0, "In progress", "High", M, -2),
        ("northstar", "Update Kaveri buyer details", "Confirm GSTIN and contact email on the connection.", P, -3, "Done", "Normal", M, -8),
        ("northstar", "Reconcile last month's receipts", "Match recorded payments to shared invoices.", P, 2, "Open", "Normal", M, -1),
        ("northstar", "Draft reminder for INV-2025-0835", "Prepare a gentle reminder for Apex Industrial Supply.", P, 4, "Open", "Normal", A, 0),
        ("northstar", "Review approval trail sample", "Sample ten approved records and note any exceptions.", N, 6, "Open", "Normal", A, -2),
        ("meridian", "Confirm PO for BILL-4518", "Packaging print run has no matching purchase order yet.", R, -2, "Open", "High", K, -5),
        ("meridian", "Match BILL-4512 to goods receipt", "Check delivery against the purchase order before approval.", R, 1, "Open", "High", K, -1),
        ("meridian", "Capture pending vendor bills", "Enter bills received by email into the AP inbox.", R, 3, "In progress", "Normal", K, -2),
        ("meridian", "Archive paid bill documents", "File supporting documents for settled bills.", R, -1, "Done", "Normal", K, -6),
    ]
    for i, (org, title, desc, who, due, status, pri, by, assigned) in enumerate(tasks, 1):
        con.execute(f"INSERT INTO calendar_events {cols} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"evt_seed_t{i}", org, "task", title, desc, day(assigned), "", "", day(due), "[]", who, by, status, pri, ts, ts))


# --------------------------------------------------------------------------- business features seed
# Shared with supabase/migrations/004_business_features.sql (generated from these lists).
# Offsets are days relative to today. All businesses, people and amounts are fictional.
NAMES = {"northstar": "Northstar Studio", "meridian": "Meridian Retail", "apex": "Apex Industrial Supply",
         "trident": "Trident Auto Parts", "kaveri": "Kaveri Foods"}
GST = {"northstar": "29AABCN1234A1Z5", "meridian": "27AAMCM5678B2Z8", "apex": "27AAAPA1111C1Z2",
       "trident": "27AABTT2222D1Z3", "kaveri": "29AAKCK3333E1Z4"}
# id, supplier, customer, issue, due, po, description, qty, rate, tax, status, paid_off, paid_fraction, disputed_before
HISTORY_INVOICES = [
    ("INV-2025-0780", "northstar", "trident", -125, -95, "PO-TR-019", "Annual brand retainer: final quarter", 1, 118000, 18, "Overdue", None, 0, False),
    ("INV-2025-0790", "northstar", "kaveri", -100, -70, "PO-KV-288", "Festive packaging artwork", 1, 64500, 12, "Overdue", None, 0, False),
    ("INV-2025-0801", "northstar", "meridian", -88, -58, "PO-MR-071", "Store window campaign design", 1, 182000, 18, "Paid", -50, 1, False),
    ("INV-2025-0805", "northstar", "apex", -85, -55, "PO-AP-160", "Product catalogue layout", 1, 76000, 18, "Paid", -57, 1, False),
    ("INV-2025-0808", "northstar", "kaveri", -80, -50, "PO-KV-270", "Label redesign: spice range", 3, 21500, 12, "Paid", -52, 1, False),
    ("INV-2025-0810", "northstar", "trident", -78, -48, "PO-TR-031", "Dealer brochure series", 1, 92000, 18, "Paid", -30, 1, False),
    ("INV-2025-0812", "northstar", "meridian", -72, -42, "PO-MR-079", "Loyalty programme creative", 1, 148000, 18, "Paid", -35, 1, True),
    ("INV-2025-0815", "northstar", "apex", -66, -36, "PO-AP-171", "Trade show booth graphics", 1, 58500, 18, "Paid", -37, 1, False),
    ("INV-2025-0818", "northstar", "meridian", -60, -30, "PO-MR-088", "Monsoon sale campaign", 1, 226000, 18, "Paid", -31, 1, False),
    ("INV-2025-0820", "northstar", "kaveri", -55, -25, "PO-KV-279", "Recipe card illustrations", 4, 9800, 12, "Paid", -25, 1, False),
    ("INV-2025-0822", "northstar", "trident", -52, -22, "PO-TR-038", "Service manual design", 1, 134000, 18, "Partially paid", -12, 0.5, False),
    ("INV-2025-0824", "northstar", "meridian", -48, -18, "PO-MR-094", "In-store signage system", 1, 118500, 18, "Approved", None, 0, False),
    ("INV-2025-0826", "northstar", "apex", -45, -15, "PO-AP-180", "Safety poster series", 1, 42000, 18, "Paid", -16, 1, False),
    ("INV-2025-0828", "northstar", "kaveri", -70, -40, "PO-KV-295", "Social media content pack", 1, 55000, 18, "Overdue", None, 0, True),
    ("INV-2025-0830", "northstar", "meridian", -35, -5, "PO-MR-098", "Customer survey report design", 1, 68000, 18, "Viewed", None, 0, False),
    ("INV-2025-0832", "northstar", "apex", -30, 0, "PO-AP-188", "Annual report design", 1, 165000, 18, "Approved", None, 0, False),
    ("INV-2025-0834", "northstar", "meridian", -25, 5, "PO-MR-104", "Festive gifting catalogue", 1, 138000, 18, "Approved", None, 0, False),
    ("INV-2025-0845", "northstar", "trident", -20, 10, "PO-TR-047", "Website banner refresh", 1, 48000, 18, "Sent", None, 0, False),
    ("INV-2025-0852", "northstar", "kaveri", -10, 35, "PO-KV-318", "New product launch kit", 1, 112000, 18, "Sent", None, 0, False),
    ("INV-2025-0855", "northstar", "meridian", -3, 45, "PO-MR-120", "Spring collection lookbook", 1, 245000, 18, "Sent", None, 0, False),
    ("INV-2025-0858", "northstar", "apex", -1, 55, "PO-AP-205", "Brand guidelines retainer", 1, 180000, 18, "Sent", None, 0, False),
    ("INV-2025-0860", "northstar", "trident", 0, 60, "PO-TR-052", "Quarterly creative services (next quarter)", 1, 96000, 18, "Sent", None, 0, False),
]
PROMISES = {"INV-2025-0839": 3, "INV-2025-0822": 6, "INV-2025-0790": -2}  # promise-to-pay offsets
PAID_EXISTING = {"INV-2025-0841": -3}
# id, buyer, vendor, ref, received, due, po, description, amount (None = linked invoice total), source, status,
# confidence, paid_off, discount_pct, discount_by_off, payment_run
HISTORY_BILLS = [
    ("BILL-4470", "meridian", "northstar", "INV-2025-0801", -88, -58, "PO-MR-071", "Store window campaign design", None, "network", "Paid", 1.0, -50, 0, None, ""),
    ("BILL-4478", "meridian", "northstar", "INV-2025-0812", -72, -42, "PO-MR-079", "Loyalty programme creative", None, "network", "Paid", 1.0, -35, 0, None, ""),
    ("BILL-4486", "meridian", "northstar", "INV-2025-0818", -60, -30, "PO-MR-088", "Monsoon sale campaign", None, "network", "Paid", 1.0, -31, 0, None, "PR-0006"),
    ("BILL-4490", "meridian", "apex", "AP-2025-088", -70, -38, "MR-PO-790", "Shelf-edge printing", 88500, "upload", "Paid", 0.97, -40, 0, None, ""),
    ("BILL-4494", "meridian", "trident", "TR-2025-031", -54, -24, "MR-PO-806", "Delivery van fit-out parts", 146000, "manual", "Paid", 0.94, -31, 0, None, "PR-0006"),
    ("BILL-4526", "meridian", "northstar", "INV-2025-0824", -48, -18, "PO-MR-094", "In-store signage system", None, "network", "Approved", 1.0, None, 0, None, ""),
    ("BILL-4530", "meridian", "northstar", "INV-2025-0834", -25, 5, "PO-MR-104", "Festive gifting catalogue", None, "network", "Approved", 1.0, None, 0, None, ""),
    ("BILL-4532", "meridian", "apex", "AP-2025-118", -12, 9, "MR-PO-884", "Point-of-sale stands", 132000, "upload", "Approved", 0.97, None, 2, 2, ""),
    ("BILL-4534", "meridian", "trident", "TR-2025-052", -8, 16, "MR-PO-889", "Warehouse racking spares", 74800, "manual", "Approved", 0.95, None, 1.5, 4, ""),
    ("BILL-4536", "meridian", "apex", "AP-2025-121", -4, 34, "MR-PO-893", "Seasonal packaging stock", 208000, "upload", "Approved", 0.98, None, 0, None, ""),
    ("BILL-4538", "meridian", "trident", "TR-2025-055", -15, 12, "MR-PO-876", "Display lighting kits", 96500, "manual", "Scheduled", 0.96, None, 0, None, "PR-0007"),
    ("BILL-4540", "meridian", "northstar", "INV-2025-0830", -35, -5, "PO-MR-098", "Customer survey report design", None, "network", "Received", 1.0, None, 0, None, ""),
    ("BILL-4542", "meridian", "northstar", "INV-2025-0855", -3, 45, "PO-MR-120", "Spring collection lookbook", None, "network", "Received", 1.0, None, 0, None, ""),
    ("BILL-4544", "meridian", "northstar", "INV-2025-0850", -2, 28, "PO-MR-115", "Seasonal campaign photography", None, "network", "Received", 1.0, None, 0, None, ""),
    ("BILL-3099", "northstar", "apex", "AP-NS-290", -50, -20, "NS-PO-410", "Print proofs: monsoon campaign", 46000, "upload", "Paid", 0.96, -21, 0, None, ""),
    ("BILL-3101", "northstar", "apex", "AP-NS-301", -14, 6, "NS-PO-422", "Studio lighting rental", 84000, "upload", "Approved", 0.97, None, 0, None, ""),
    ("BILL-3102", "northstar", "trident", "TR-NS-112", -10, 13, "NS-PO-425", "Exhibition stand fabrication", 165000, "manual", "Approved", 0.93, None, 0, None, ""),
    ("BILL-3103", "northstar", "apex", "AP-NS-305", -6, 24, "NS-PO-431", "Print production: Meridian launch", 212000, "upload", "Received", 0.95, None, 0, None, ""),
    ("BILL-3104", "northstar", "trident", "TR-NS-118", -3, 38, "NS-PO-436", "Event logistics and transport", 96000, "manual", "Needs approval", 0.92, None, 0, None, ""),
    ("BILL-3106", "northstar", "trident", "TR-NS-120", -9, 2, "NS-PO-433", "Production crew and camera equipment", 340000, "manual", "Approved", 0.94, None, 0, None, ""),
    ("BILL-3107", "northstar", "apex", "AP-NS-311", -5, 9, "NS-PO-438", "Annual design software licences", 295000, "upload", "Approved", 0.98, None, 0, None, ""),
    ("BILL-3108", "northstar", "apex", "AP-NS-314", -2, 20, "NS-PO-441", "Studio fit-out: second instalment", 420000, "upload", "Needs approval", 0.95, None, 0, None, ""),
    ("BILL-3105", "northstar", "apex", "AP-NS-309", -1, 52, "NS-PO-440", "Packaging prototypes", 58000, "upload", "Received", 0.96, None, 0, None, ""),
]
# id, buyer, strategy, status, pay_off, created_off, staff
PAYMENT_RUNS = [
    ("PR-0006", "meridian", "by_due", "Paid", -31, -33, "staff_riya"),
    ("PR-0007", "meridian", "preserve_cash", "Scheduled", 3, -1, "staff_riya"),
]
# id, invoice, tone, offset, staff
REMINDERS = [
    ("rem_seed_1", "INV-2025-0780", "firm", -30, "staff_priya"),
    ("rem_seed_2", "INV-2025-0790", "gentle", -14, "staff_priya"),
    ("rem_seed_3", "INV-2025-0839", "gentle", -6, "staff_priya"),
    ("rem_seed_4", "INV-2025-0780", "final", -9, "staff_meera"),
    ("rem_seed_5", "INV-2025-0828", "firm", -3, "staff_priya"),
]
# id, org, audience, kind, title, body, link_page, link_id, day offset, time, read_by
NOTIFICATIONS = [
    ("ntf_seed_01", "northstar", "", "payment", "Apex Industrial Supply paid INV-2025-0841", "Payment recorded on the shared invoice (demo).", "detail", "INV-2025-0841", -3, "11:20", ["owner", "finance_manager"]),
    ("ntf_seed_02", "northstar", "", "dispute", "Meridian Retail raised a query", "INV-2025-0842 · Deliverable scope query", "detail", "INV-2025-0842", -2, "15:05", ["owner"]),
    ("ntf_seed_03", "northstar", "", "promise", "Promise to pay missed", "Kaveri Foods promised INV-2025-0790 two days ago.", "collections", "INV-2025-0790", -1, "09:00", []),
    ("ntf_seed_04", "northstar", "", "view", "Kaveri Foods viewed INV-2025-0836", "The buyer opened the shared invoice.", "detail", "INV-2025-0836", -1, "16:40", []),
    ("ntf_seed_05", "northstar", "ar", "task", "New work assigned to you", "Draft reminder for INV-2025-0835 · from Arjun Kulkarni", "calendar", "", 0, "09:10", []),
    ("ntf_seed_06", "northstar", "", "comment", "Meridian Retail replied on INV-2025-0838", "Quantity mismatch query on the shared invoice.", "detail", "INV-2025-0838", 0, "10:30", []),
    ("ntf_seed_07", "meridian", "approver", "approval", "BILL-4521 needs your approval", "Northstar Studio · ₹1,86,000", "bills", "BILL-4521", -4, "12:00", []),
    ("ntf_seed_08", "meridian", "", "reminder", "Northstar Studio sent a payment reminder", "INV-2025-0824 is past due (demo reminder, nothing was emailed).", "bills", "BILL-4526", -2, "10:00", ["approver"]),
    ("ntf_seed_09", "meridian", "", "invoice", "New invoice from Northstar Studio", "INV-2025-0855 · Spring collection lookbook", "bills", "BILL-4542", -3, "14:15", ["ap"]),
    ("ntf_seed_10", "meridian", "", "payment_run", "Payment run PR-0007 scheduled", "1 bill · ₹96,500 · simulated, no money moves.", "paymentRun", "PR-0007", -1, "17:30", []),
    ("ntf_seed_11", "meridian", "ap", "task", "New work assigned to you", "Match BILL-4512 to goods receipt · from Kavita Rao", "calendar", "", -1, "09:45", []),
]
ORG_SETTINGS = [("northstar", 525000, 0), ("meridian", 1850000, 150000)]
REMINDER_TEXT = {
    "gentle": "Hi {name} team, a friendly note that {iid} for {amount} was due on {due}. Could you share an expected payment date? Thank you.",
    "firm": "Hello {name} team, {iid} for {amount} is now {late} days past due. Please arrange payment or tell us what is holding it up this week.",
    "final": "Dear {name} team, {iid} for {amount} is {late} days overdue despite earlier reminders. Please settle it within 7 days so we can keep your account in good standing.",
}


def invoice_total(qty, rate, tax):
    return round(qty * rate * (1 + tax / 100), 2)


def business_seed_rows(day, stamp):
    """Rows for the business-features seed. `day(off)` -> ISO date, `stamp(off, 'HH:MM')` -> ISO timestamp."""
    rows = {k: [] for k in ("invoices", "activity", "bills", "bill_activity", "payment_runs", "payment_run_items",
                            "reminders", "notifications", "org_settings")}
    totals = {}
    for (iid, sup, cus, io, do, po, desc, qty, rate, tax, status, paid_off, frac, disputed) in HISTORY_INVOICES:
        total = invoice_total(qty, rate, tax)
        totals[iid] = total
        rows["invoices"].append({
            "id": iid, "supplier": sup, "customer": cus, "supplier_gstin": GST[sup], "customer_gstin": GST[cus],
            "issue_date": day(io), "due_date": day(do), "po_number": po, "description": desc, "qty": qty, "rate": rate,
            "tax": tax, "total": total, "status": status, "dispute_reason": "",
            "amount_paid": round(total * frac, 2), "paid_date": day(paid_off) if status == "Paid" else "",
            "promised_date": day(PROMISES[iid]) if iid in PROMISES else "",
            "created_at": stamp(io, "09:30"), "updated_at": stamp(min(0, paid_off if paid_off is not None else io + 1), "12:00")})
        ev = [(io, sup, "Invoice sent", NAMES[cus], "09:30")]
        if status != "Sent":
            ev.append((io + 1, cus, "Viewed", "Opened the shared invoice", "11:00"))
        if disputed:
            ev.append((io + 4, cus, "Dispute", "Line item query raised by the buyer", "15:00"))
            ev.append((io + 9, sup, "Resolved", "Revised scope note shared", "10:00"))
        if status in ("Approved", "Paid", "Partially paid"):
            ev.append((io + 5 if disputed else io + 3, cus, "Approved", "Status updated", "12:30"))
        if status == "Overdue":
            ev.append((do + 1, sup, "Overdue", "Marked overdue after the due date", "09:00"))
        if status == "Paid":
            ev.append((paid_off, cus, "Paid", "Payment recorded (demo)", "16:00"))
        if status == "Partially paid":
            ev.append((paid_off, cus, "Partially paid", f"₹{round(total * frac):,} recorded (demo)", "16:00"))
        for off, actor, action, detail, t in ev:
            rows["activity"].append({"invoice_id": iid, "actor": actor, "action": action, "detail": detail,
                                     "created_at": stamp(min(off, 0), t)})
    for (bid, buyer, vendor, ref, ro, do, po, desc, amount, src, status, conf, paid_off, disc, disc_by, run) in HISTORY_BILLS:
        amount = totals.get(ref, amount) if amount is None else amount
        rows["bills"].append({
            "id": bid, "buyer": buyer, "vendor": vendor, "vendor_invoice_id": ref, "received_date": day(ro),
            "due_date": day(do), "po_number": po, "description": desc, "amount": amount, "source": src,
            "status": status, "ocr_confidence": conf, "created_at": stamp(ro, "10:00"),
            "paid_date": day(paid_off) if paid_off is not None else "", "scheduled_date": "",
            "discount_pct": disc, "discount_by": day(disc_by) if disc_by is not None else "", "payment_run_id": run})
        steps = [(ro, buyer, "Bill received", f"Added to AP inbox · {src} entry")]
        chain = ["Received", "Needs approval", "Approved", "Scheduled", "Paid"]
        target = chain.index(status) if status in chain else 0
        prev = "Received"
        for i, st in enumerate(chain[1:target + 1], 1):
            if st == "Scheduled" and not run:
                continue
            off = paid_off if st == "Paid" else min(ro + i, 0)
            steps.append((off, buyer, "Bill status changed", f"{prev} → {st}"))
            prev = st
        for off, actor, action, detail in steps:
            rows["bill_activity"].append({"bill_id": bid, "actor": actor, "action": action, "detail": detail,
                                          "created_at": stamp(min(off, 0), "13:00")})
    bill_amount = {b["id"]: b["amount"] for b in rows["bills"]}
    for rid, buyer, strategy, status, pay_off, created_off, staff in PAYMENT_RUNS:
        items = [b for b in HISTORY_BILLS if b[15] == rid]
        total = round(sum(bill_amount[b[0]] for b in items), 2)
        rows["payment_runs"].append({"id": rid, "buyer": buyer, "strategy": strategy, "status": status,
                                     "pay_date": day(pay_off), "total": total, "discount": 0, "bill_count": len(items),
                                     "created_by_staff": staff, "created_at": stamp(created_off, "17:20"),
                                     "updated_at": stamp(min(pay_off, 0), "17:30")})
        for b in items:
            rows["payment_run_items"].append({"id": f"pri_{rid}_{b[0]}", "run_id": rid, "bill_id": b[0],
                                              "amount": bill_amount[b[0]], "discount": 0,
                                              "created_at": stamp(created_off, "17:20")})
            if status == "Scheduled":
                rows["bill_activity"].append({"bill_id": b[0], "actor": buyer, "action": "Added to payment run",
                                              "detail": f"{rid} · pays on {day(pay_off)} (demo)",
                                              "created_at": stamp(created_off, "17:20")})
    for b in rows["bills"]:
        run = next((r for r in PAYMENT_RUNS if r[0] == b["payment_run_id"]), None)
        if run:
            b["scheduled_date"] = day(run[4])
    inv_info = {r[0]: r for r in HISTORY_INVOICES}
    inv_info.update({"INV-2025-0839": ("INV-2025-0839", "northstar", "trident", -40, -10, "", "", 1, 71895, 18)})
    for rid, iid, tone, off, staff in REMINDERS:
        r = inv_info[iid]
        due_off = r[4]
        amount = invoice_total(r[7], r[8], r[9])
        body = REMINDER_TEXT[tone].format(name=NAMES[r[2]], iid=iid, amount=f"₹{amount:,.0f}", due=day(due_off),
                                          late=max(0, off - due_off))
        rows["reminders"].append({"id": rid, "invoice_id": iid, "org": "northstar", "tone": tone, "body": body,
                                  "status": "Sent (demo)", "created_by_staff": staff, "created_at": stamp(off, "10:40")})
        rows["activity"].append({"invoice_id": iid, "actor": "northstar", "action": "Reminder sent (demo)",
                                 "detail": f"{tone.title()} reminder · no email was sent", "created_at": stamp(off, "10:40")})
    for iid, off in PROMISES.items():
        rows["activity"].append({"invoice_id": iid, "actor": "northstar", "action": "Promise to pay recorded",
                                 "detail": f"Customer promised payment by {day(off)}", "created_at": stamp(min(off, 0) - 4, "12:10")})
    for nid, org, aud, kind, title, body, lp, lid, off, t, read in NOTIFICATIONS:
        rows["notifications"].append({"id": nid, "org": org, "audience": aud, "kind": kind, "title": title, "body": body,
                                      "link_page": lp, "link_id": lid, "read_by": json.dumps(read), "created_at": stamp(off, t)})
    for org, bal, thr in ORG_SETTINGS:
        rows["org_settings"].append({"org": org, "opening_balance": bal, "approval_threshold": thr, "updated_at": stamp(0, "08:00")})
    return rows


def _migrate(con):
    for table, cols in ADDED_COLUMNS.items():
        have = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
        for name, ddl in cols:
            if name not in have:
                con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def _seed_business(con):
    if con.execute("SELECT 1 FROM org_settings LIMIT 1").fetchone():
        return
    today = datetime.date.today()
    day = lambda off: (today + datetime.timedelta(days=off)).isoformat()
    stamp = lambda off, t: f"{day(off)}T{t}:00"
    rows = business_seed_rows(day, stamp)
    existing = {r[0] for r in con.execute("SELECT id FROM invoices")} | {r[0] for r in con.execute("SELECT id FROM bills")}
    for table, items in rows.items():
        for r in items:
            if table in ("invoices", "bills") and r["id"] in existing:
                continue
            cols = list(r)
            con.execute(f"INSERT OR IGNORE INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [r[c] for c in cols])
    for iid, off in PROMISES.items():
        con.execute("UPDATE invoices SET promised_date=? WHERE id=? AND promised_date=''", (day(off), iid))
    for iid, off in PAID_EXISTING.items():
        con.execute("UPDATE invoices SET paid_date=?, amount_paid=total WHERE id=? AND status='Paid'", (day(off), iid))
        con.execute("INSERT INTO activity (invoice_id,actor,action,detail,created_at) VALUES (?,?,?,?,?)",
                    (iid, "apex", "Paid", "Payment recorded (demo)", stamp(off, "11:20")))


# ASSISTANT seed: a little fictional history so the activity page has shape (only states that match the seeded records).
def _seed_assistant(con):
    if con.execute("SELECT 1 FROM ai_action LIMIT 1").fetchone():
        return
    today = datetime.date.today()
    st = lambda off, t: f"{(today + datetime.timedelta(days=off)).isoformat()}T{t}:00"
    rows = [  # org, actor, role, text, intent, kind, summary, status, result, offset, time
        ("northstar", "northstar", "finance_manager", "remind overdue customers", "remind_overdue", "remind_overdue",
         "Send reminders on overdue invoices", "Confirmed", "3 demo reminders recorded. Nothing was emailed.", -6, "10:40"),
        ("northstar", "northstar", "ar", "remind overdue customers", "remind_overdue", "remind_overdue",
         "Send reminders on overdue invoices", "Confirmed", "2 demo reminders recorded. Nothing was emailed.", -3, "10:40"),
        ("northstar", "northstar", "ar", "mark INV-2025-0841 as paid", "mark_paid", "invoice_paid",
         "Mark INV-2025-0841 as Paid", "Confirmed", "INV-2025-0841 marked Paid (demo, no money moved).", -3, "11:20"),
        ("northstar", "northstar", "owner", "mark INV-2025-0839 as paid", "mark_paid", "invoice_paid",
         "Mark INV-2025-0839 as Paid", "Cancelled", "", -2, "16:05"),
        ("meridian", "meridian", "approver", "approve BILL-4509", "approve_bill", "bill_approve",
         "Approve BILL-4509", "Confirmed", "BILL-4509 approved.", -4, "12:10"),
    ]
    for i, (org, actor, role, text, intent, kind, summary, status, result, off, t) in enumerate(rows, 1):
        con.execute("INSERT INTO ai_action (id,org,actor,role,input_text,intent,kind,payload,status,result_text,created_at,decided_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (f"ai_seed_{i}", org, actor, role, text, intent, kind, json.dumps({"summary": summary}), status, result,
                     st(off, t), st(off, t[:3] + "42")))


class LocalDB:
    def __init__(self):
        global _initialised
        with _init_lock:
            if not _initialised:
                con = _connect()
                try:
                    con.execute("PRAGMA journal_mode=WAL")
                    con.executescript(SCHEMA)
                    _migrate(con)
                    _seed(con)
                    _seed_calendar(con)
                    _seed_business(con)
                    _seed_assistant(con)
                    con.commit()
                finally:
                    con.close()
                _initialised = True

    def _run(self, sql, params=(), write=False):
        con = _connect()
        try:
            rows = [dict(r) for r in con.execute(sql, params).fetchall()]
            if write:
                con.commit()
            return rows
        except sqlite3.IntegrityError as e:
            print("InvoiceOS local: integrity error:", e)
            from _core import ApiError
            raise ApiError(409, "The demo database rejected the request")
        finally:
            con.close()

    def select(self, table, columns="*", filters=None, order=None, limit=None):
        assert table in TABLES
        cols = "*" if columns == "*" else ",".join(c for c in columns.split(",") if COLUMN_RE.fullmatch(c))
        where, params = _where(filters)
        sql = f"SELECT {cols} FROM {table}{where}"
        if order:
            parts = []
            for o in order.split(","):
                col, _, d = o.partition(".")
                if COLUMN_RE.fullmatch(col):
                    parts.append(f"{col} {'DESC' if d == 'desc' else 'ASC'}")
            if parts:
                sql += " ORDER BY " + ", ".join(parts)
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        return self._run(sql, params)

    def one(self, table, columns="*", filters=None):
        rows = self.select(table, columns, filters, limit=1)
        return rows[0] if rows else None

    def insert(self, table, data):
        assert table in TABLES
        cols = [c for c in data if COLUMN_RE.fullmatch(c)]
        sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})"
        self._run(sql, [data[c] for c in cols], write=True)
        return [data]

    def update(self, table, filters, data):
        assert table in TABLES
        cols = [c for c in data if COLUMN_RE.fullmatch(c)]
        where, params = _where(filters)
        con = _connect()
        try:
            cur = con.execute(
                f"UPDATE {table} SET {','.join(c + '=?' for c in cols)}{where}",
                [data[c] for c in cols] + params,
            )
            con.commit()
            return [data] * cur.rowcount
        finally:
            con.close()
