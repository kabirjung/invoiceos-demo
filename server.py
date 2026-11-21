#!/usr/bin/env python3
"""Local InvoiceOS demo API. Uses only Python's standard library and SQLite."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json, sqlite3, uuid, datetime, re, os, errno, gzip, hashlib, time, traceback
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

ROOT = Path(__file__).resolve().parent
DB = ROOT / "invoiceos.sqlite3"
TODAY = datetime.date.today().isoformat()
VERSION = "1.1.0"
STARTED_AT = time.time()

def connect():
    db = sqlite3.connect(DB, timeout=5.0)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    db.execute("PRAGMA synchronous=NORMAL")
    return db

def init_db():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, city TEXT DEFAULT '', gstin TEXT DEFAULT '', email TEXT DEFAULT '', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, supplier TEXT NOT NULL, customer TEXT NOT NULL, supplier_gstin TEXT DEFAULT '', customer_gstin TEXT DEFAULT '', issue_date TEXT NOT NULL, due_date TEXT NOT NULL, po_number TEXT DEFAULT '', description TEXT NOT NULL, qty REAL NOT NULL, rate REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, status TEXT NOT NULL, dispute_reason TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT NOT NULL, actor TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bills(id TEXT PRIMARY KEY, buyer TEXT NOT NULL, vendor TEXT NOT NULL, vendor_invoice_id TEXT NOT NULL, received_date TEXT NOT NULL, due_date TEXT NOT NULL, po_number TEXT DEFAULT '', description TEXT NOT NULL, amount REAL NOT NULL, source TEXT NOT NULL DEFAULT 'network', status TEXT NOT NULL DEFAULT 'Received', ocr_confidence REAL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS bill_activity(id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY, requester TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_invoice_status_due ON invoices(status,due_date);
        CREATE INDEX IF NOT EXISTS idx_activity_invoice_created ON activity(invoice_id,created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_bill_buyer_status_due ON bills(buyer,status,due_date);
        CREATE INDEX IF NOT EXISTS idx_bill_activity_bill_created ON bill_activity(bill_id,created_at DESC);
        """)
        if db.execute("SELECT COUNT(*) FROM invoices").fetchone()[0] == 0:
            stamp_now = datetime.datetime.now().isoformat(timespec="seconds")
            businesses = [
                ("northstar", "Northstar Studio", "supplier", "Bengaluru", "29AABCN1234A1Z5", "accounts@northstar.example", stamp_now),
                ("meridian", "Meridian Retail Pvt Ltd", "buyer", "Mumbai", "27AAMCM5678B2Z8", "ap@meridian.example", stamp_now),
                ("apex", "Apex Industrial Supply", "both", "Pune", "27AAAPA1111C1Z2", "finance@apex.example", stamp_now),
                ("trident", "Trident Auto Parts", "both", "Nashik", "27AABTT2222D1Z3", "accounts@trident.example", stamp_now),
            ]
            db.executemany("INSERT INTO businesses VALUES(?,?,?,?,?,?,?)", businesses)
            samples = [
                ("INV-2025-0842", "northstar", "meridian", "12 Feb 2025", "12 Mar 2025", "PO-MR-102", "Brand strategy and campaign design", 1, 210000, 18, "Dispute", "Deliverable scope query"),
                ("INV-2025-0841", "northstar", "apex", "11 Feb 2025", "13 Mar 2025", "PO-AP-203", "Website and product copywriting", 1, 149322, 18, "Paid", ""),
                ("INV-2025-0839", "northstar", "trident", "08 Feb 2025", "10 Mar 2025", "PO-TR-044", "Quarterly creative services", 1, 71895, 18, "Overdue", ""),
                ("INV-2025-0838", "northstar", "meridian", "07 Feb 2025", "09 Mar 2025", "PO-MR-101", "Retail launch campaign creative", 1, 264000, 18, "Dispute", "Quantity mismatch"),
                ("INV-2025-0835", "northstar", "apex", "04 Feb 2025", "06 Mar 2025", "PO-AP-199", "Brand identity refresh", 1, 105339, 18, "Sent", ""),
                ("INV-2025-0847", "apex", "meridian", "16 Feb 2025", "18 Mar 2025", "PO-MR-008", "Replacement pump set", 4, 94000, 18, "Pending approval", ""),
            ]
            for item in samples:
                iid, supplier, customer, issue, due, po, desc, qty, rate, tax, status, reason = item
                s_gst = next(x[4] for x in businesses if x[0] == supplier)
                c_gst = next(x[4] for x in businesses if x[0] == customer)
                total = round(qty * rate * (1 + tax / 100), 2)
                db.execute("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (iid,supplier,customer,s_gst,c_gst,issue,due,po,desc,qty,rate,tax,total,status,reason,stamp_now,stamp_now))
                db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)", (iid,supplier,"Invoice created",status,stamp_now))
            db.execute("INSERT INTO connections VALUES(?,?,?,?,?,?,?)", ("conn_northstar_meridian","northstar","meridian","Connected",json.dumps(["exchange_invoices","share_payment_status"]),stamp_now,stamp_now))
            bills = [
                ("BILL-4521","meridian","northstar","NS-2025-0192","2025-02-16","2025-03-18","MR-PO-880","Brand identity and campaign design",186000,"network","Needs approval",0.99),
                ("BILL-4518","meridian","apex","AP-2025-110","2025-02-15","2025-03-17","MR-PO-870","Packaging print run",94400,"upload","Received",0.96),
                ("BILL-4512","meridian","trident","TR-2025-044","2025-02-13","2025-03-15","MR-PO-852","Retail display fixtures",225000,"email","Needs approval",0.93),
                ("BILL-4509","meridian","northstar","NS-2025-0184","2025-02-12","2025-03-14","MR-PO-841","Product photography",72000,"network","Approved",0.99),
            ]
            db.executemany("INSERT INTO bills(id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,amount,source,status,ocr_confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [(*b,stamp_now) for b in bills])
        # Seed/migrate supporting demo data even when an older invoice database already exists.
        db.execute("UPDATE businesses SET name='Northstar Studio',city='Bengaluru',gstin='29AABCN1234A1Z5' WHERE id='northstar'")
        db.execute("INSERT OR IGNORE INTO businesses VALUES(?,?,?,?,?,?,?)",('kaveri','Kaveri Retail Pvt Ltd','buyer','Bengaluru','29AABCK5555E1Z4','finance@kaveri.example',now()))
        db.execute("UPDATE invoices SET description=CASE id WHEN 'INV-2025-0842' THEN 'Brand strategy and campaign design' WHEN 'INV-2025-0841' THEN 'Website and product copywriting' WHEN 'INV-2025-0839' THEN 'Quarterly creative services' WHEN 'INV-2025-0838' THEN 'Retail launch campaign creative' WHEN 'INV-2025-0835' THEN 'Brand identity refresh' ELSE description END WHERE id IN ('INV-2025-0842','INV-2025-0841','INV-2025-0839','INV-2025-0838','INV-2025-0835')")
        seeded_ids=['INV-2025-0842','INV-2025-0841','INV-2025-0839','INV-2025-0838','INV-2025-0835','INV-2025-0847']
        for offset,iid in enumerate(seeded_ids, start=2):
            issued=(datetime.date.today()-datetime.timedelta(days=offset*5)).isoformat()
            due=(datetime.date.today()+datetime.timedelta(days=30-offset*5)).isoformat()
            db.execute("UPDATE invoices SET issue_date=?,due_date=? WHERE id=?",(issued,due,iid))
        # A varied, recent demo set gives both sides useful filters and status views.
        extra_statuses=['Draft','Sent','Viewed','Overdue','Dispute','Partially paid','Paid','Sent','Pending approval','Sent','Dispute','Paid','Partially paid','Draft','Sent','Pending approval','Approved','Paid']
        if db.execute("SELECT COUNT(*) FROM invoices").fetchone()[0] < 24:
            customers=['meridian','apex','trident']
            descriptions=['Campaign design retainer','Retail launch creative','Brand identity system','Product photography','Social content package','Website design sprint']
            for ix,status in enumerate(extra_statuses):
                iid=f"INV-2026-{901+ix:04d}"
                if db.execute("SELECT 1 FROM invoices WHERE id=?",(iid,)).fetchone(): continue
                issued=(datetime.date.today()-datetime.timedelta(days=60-ix*3)).isoformat()
                due=(datetime.date.fromisoformat(issued)+datetime.timedelta(days=30)).isoformat()
                qty=1+(ix%4); rate=35000+ix*2750; tax=18; total=round(qty*rate*1.18,2);stamp=now();customer=customers[ix%len(customers)]
                sup=db.execute("SELECT gstin FROM businesses WHERE id='northstar'").fetchone()[0]
                buyer_gstin=db.execute("SELECT gstin FROM businesses WHERE id=?",(customer,)).fetchone()[0]
                db.execute("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(iid,'northstar',customer,sup,buyer_gstin,issued,due,f"PO-{customer[:2].upper()}-{850+ix}",descriptions[ix%len(descriptions)],qty,rate,tax,total,status,"Quantity confirmation required" if status=='Dispute' else "",stamp,stamp))
                db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(iid,'northstar','Invoice created','Shared demo invoice',stamp))
        db.execute("UPDATE invoices SET status='Sent' WHERE id='INV-2026-0910' AND status='Viewed' AND NOT EXISTS (SELECT 1 FROM activity WHERE invoice_id='INV-2026-0910' AND action='Viewed')")
        stamp=now()
        seeded_pairs=[('northstar','meridian'),('northstar','apex'),('northstar','trident'),('northstar','kaveri'),('meridian','apex'),('meridian','trident')]
        for requester,target in seeded_pairs:
            cid=f"conn_{requester}_{target}"
            db.execute("INSERT OR IGNORE INTO connections VALUES(?,?,?,?,?,?,?)",(cid,requester,target,'Connected',json.dumps(['exchange_invoices','share_payment_status']),stamp,stamp))
        if db.execute("SELECT COUNT(*) FROM bills").fetchone()[0] == 0:
            stamp=now()
            bills=[
                ("BILL-4521","meridian","northstar","NS-2025-0192","2025-02-16","2025-03-18","MR-PO-880","Brand identity and campaign design",186000,"network","Needs approval",0.99),
                ("BILL-4518","meridian","apex","AP-2025-110","2025-02-15","2025-03-17","MR-PO-870","Packaging print run",94400,"upload","Received",0.96),
                ("BILL-4512","meridian","trident","TR-2025-044","2025-02-13","2025-03-15","MR-PO-852","Retail display fixtures",225000,"email","Needs approval",0.93),
                ("BILL-4509","meridian","northstar","NS-2025-0184","2025-02-12","2025-03-14","MR-PO-841","Product photography",72000,"network","Approved",0.99),
            ]
            db.executemany("INSERT INTO bills(id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,amount,source,status,ocr_confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",[(*b,stamp) for b in bills])
        if db.execute("SELECT COUNT(*) FROM bills").fetchone()[0] < 12:
            now_date=datetime.date.today()
            for ix in range(8):
                bid=f"BILL-{4530+ix}"
                vendor=['northstar','apex','trident'][ix%3]
                received=(now_date-datetime.timedelta(days=ix*4+1)).isoformat()
                due=(now_date+datetime.timedelta(days=29-ix*3)).isoformat()
                db.execute("INSERT OR IGNORE INTO bills(id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,amount,source,status,ocr_confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(bid,'meridian',vendor,f"{vendor[:2].upper()}-26-{ix+210}",received,due,f"MR-PO-{910+ix}",['Studio monthly retainer','Packaging artwork','Retail campaign photography'][ix%3],64000+ix*18250,['network','email','upload'][ix%3],['Received','Needs approval','Approved','Paid'][ix%4],0.89+0.01*(ix%10),now()))
        for offset,bid in enumerate(['BILL-4521','BILL-4518','BILL-4512','BILL-4509'],start=1):
            received=(datetime.date.today()-datetime.timedelta(days=offset*4)).isoformat()
            due=(datetime.date.today()+datetime.timedelta(days=30-offset*4)).isoformat()
            db.execute("UPDATE bills SET received_date=?,due_date=? WHERE id=?",(received,due,bid))
        db.execute("""
            INSERT INTO bill_activity(bill_id,actor,action,detail,created_at)
            SELECT b.id,b.buyer,'Bill available in AP','Existing demo bill · current status: '||b.status,b.created_at
            FROM bills b
            WHERE NOT EXISTS (SELECT 1 FROM bill_activity a WHERE a.bill_id=b.id)
        """)

def json_default(row): return dict(row)
def now(): return datetime.datetime.now().isoformat(timespec="seconds")

def clean_text(value, label, limit, required=True):
    value=str(value or "").strip()
    if required and not value: raise ValueError(f"{label} is required")
    if len(value)>limit: raise ValueError(f"{label} must be {limit} characters or fewer")
    return value

def iso_date(value, label):
    value=clean_text(value,label,10)
    try: datetime.date.fromisoformat(value)
    except ValueError: raise ValueError(f"{label} must be a valid date")
    return value

def decimal_value(value, label, *, minimum=Decimal("0"), maximum=Decimal("1000000000000")):
    try: number=Decimal(str(value).strip())
    except (InvalidOperation,ValueError,AttributeError): raise ValueError(f"{label} must be a valid number")
    if not number.is_finite() or number<minimum or number>maximum: raise ValueError(f"Check the {label.lower()} value")
    return number

def decimal_money(value, label):
    number=decimal_value(value,label).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)
    if number<=0: raise ValueError(f"{label} must be greater than zero")
    return number

def connection_scopes(db, first, second):
    row=db.execute("SELECT scopes FROM connections WHERE status='Connected' AND ((requester=? AND target=?) OR (requester=? AND target=?)) ORDER BY updated_at DESC LIMIT 1",(first,second,second,first)).fetchone()
    if not row: return set()
    try: return set(json.loads(row["scopes"]))
    except (ValueError,TypeError): return set()

class RequestTooLarge(ValueError): pass

class Handler(BaseHTTPRequestHandler):
    server_version = "InvoiceOSDemo/1.1"
    protocol_version = "HTTP/1.1"

    def security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: blob:; connect-src 'self'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")

    def accepts_gzip(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "").lower()

    def send_json(self, code, value):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        compress = len(body) > 1400 and self.accepts_gzip()
        if compress:
            body = gzip.compress(body, compresslevel=6)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Accept-Encoding")
        if compress:
            self.send_header("Content-Encoding", "gzip")
        self.security_headers()
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def send_error(self, code, message=None, explain=None):
        # API callers always receive JSON, even for malformed requests or bad methods.
        if urlparse(getattr(self, "path", "")).path.startswith("/api/"):
            try:
                return self.send_json(code, {"error": message or "Request failed", "status": code})
            except Exception:
                pass
        return super().send_error(code, message, explain)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 0: raise ValueError("Invalid content length")
        if size > 100_000: raise RequestTooLarge("Request body must be under 100 KB")
        try:
            data = json.loads(self.rfile.read(size) or b"{}")
        except json.JSONDecodeError:
            raise ValueError("Request body is not valid JSON")
        if not isinstance(data, dict): raise ValueError("JSON request body must be an object")
        return data

    def do_GET(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/bootstrap":
                with connect() as db:
                    businesses = [dict(r) for r in db.execute("SELECT * FROM businesses ORDER BY name")]
                    invoices = [dict(r) for r in db.execute("SELECT * FROM invoices ORDER BY created_at DESC")]
                    comments = [dict(r) for r in db.execute("SELECT * FROM comments ORDER BY created_at")]
                    activity = [dict(r) for r in db.execute("SELECT * FROM activity ORDER BY created_at DESC")]
                    bills = [dict(r) for r in db.execute("SELECT * FROM bills ORDER BY created_at DESC")]
                    bill_activity = [dict(r) for r in db.execute("SELECT * FROM bill_activity ORDER BY created_at DESC")]
                    connections = [dict(r) for r in db.execute("SELECT * FROM connections ORDER BY created_at DESC")]
                return self.send_json(200, {"businesses":businesses,"invoices":invoices,"comments":comments,"activity":activity,"bill_activity":bill_activity,"bills":bills,"connections":connections})
            if path == "/api/health": return self.health()
            if path == "/api/search": return self.search()
            if path in ("/", "/index.html", "/demo", "/demo/"): return self.static("index.html", "text/html; charset=utf-8")
            if path == "/app.js": return self.static("app.js", "text/javascript; charset=utf-8")
            if path == "/favicon.ico":
                self.send_response(204); self.security_headers(); self.end_headers(); return
            return self.send_json(404, {"error":"Not found"})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            traceback.print_exc()
            try: self.send_json(500, {"error":"The demo server hit an unexpected error"})
            except Exception: pass

    do_HEAD = do_GET

    def health(self):
        try:
            with connect() as db:
                counts = {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                          for table in ("businesses", "invoices", "bills", "connections")}
                mode = db.execute("PRAGMA journal_mode").fetchone()[0]
            return self.send_json(200, {
                "ok": True, "service": "InvoiceOS demo", "version": VERSION,
                "time": now(), "uptime_seconds": round(time.time() - STARTED_AT, 1),
                "database": {"ok": True, "engine": "sqlite", "journal_mode": mode, "counts": counts},
            })
        except Exception as exc:
            traceback.print_exc()
            return self.send_json(503, {"ok": False, "service": "InvoiceOS demo", "version": VERSION, "error": str(exc)})

    def search(self):
        params = parse_qs(urlparse(self.path).query)
        query = (params.get("q", [""])[0] or "").strip()
        if len(query) > 80: query = query[:80]
        try: limit = max(1, min(25, int(params.get("limit", ["12"])[0])))
        except (TypeError, ValueError): limit = 12
        if not query:
            return self.send_json(200, {"query": "", "count": 0, "results": []})
        org = (params.get("org", [""])[0] or "").strip()
        side = (params.get("side", [""])[0] or "").strip()
        like = f"%{query}%"
        results = []
        with connect() as db:
            inv_sql = """
                SELECT i.*, s.name AS supplier_name, c.name AS customer_name
                FROM invoices i
                LEFT JOIN businesses s ON s.id=i.supplier
                LEFT JOIN businesses c ON c.id=i.customer
                WHERE (i.id LIKE ? OR i.description LIKE ? OR i.po_number LIKE ?
                       OR s.name LIKE ? OR c.name LIKE ?)
                  AND EXISTS (SELECT 1 FROM connections x WHERE x.status='Connected' AND
                      ((x.requester=i.supplier AND x.target=i.customer) OR
                       (x.requester=i.customer AND x.target=i.supplier)))"""
            inv_params = [like] * 5
            if org and side == "supplier":
                inv_sql += " AND i.supplier=?"; inv_params.append(org)
            elif org and side == "buyer":
                inv_sql += " AND i.customer=? AND i.status!='Draft'"; inv_params.append(org)
            inv_sql += " ORDER BY i.updated_at DESC, i.id LIMIT ?"; inv_params.append(limit)
            for r in db.execute(inv_sql, inv_params):
                if len(results) >= limit: break
                results.append({
                    "type": "invoice", "id": r["id"], "title": r["id"],
                    "subtitle": f"{r['supplier_name'] or r['supplier']} → {r['customer_name'] or r['customer']}",
                    "meta": r["status"], "detail": r["description"],
                    "amount": r["total"], "date": r["due_date"], "page": "detail",
                })
            bill_sql = """
                SELECT b.*, v.name AS vendor_name
                FROM bills b LEFT JOIN businesses v ON v.id=b.vendor
                WHERE (b.id LIKE ? OR b.description LIKE ? OR b.po_number LIKE ?
                       OR b.vendor_invoice_id LIKE ? OR v.name LIKE ?)
                  AND EXISTS (SELECT 1 FROM connections x WHERE x.status='Connected' AND
                      ((x.requester=b.buyer AND x.target=b.vendor) OR
                       (x.requester=b.vendor AND x.target=b.buyer)))"""
            bill_params = [like] * 5
            if org and side == "buyer":
                bill_sql += " AND b.buyer=?"; bill_params.append(org)
            elif org and side == "supplier":
                bill_sql += " AND b.vendor=?"; bill_params.append(org)
            bill_sql += " ORDER BY b.created_at DESC, b.id LIMIT ?"; bill_params.append(limit)
            for r in db.execute(bill_sql, bill_params):
                if len(results) >= limit: break
                results.append({
                    "type": "bill", "id": r["id"], "title": r["id"],
                    "subtitle": f"{r['vendor_name'] or r['vendor']} · {r['vendor_invoice_id']}",
                    "meta": r["status"], "detail": r["description"],
                    "amount": r["amount"], "date": r["due_date"], "page": "bills",
                })
            biz_sql = "SELECT * FROM businesses WHERE (name LIKE ? OR city LIKE ? OR gstin LIKE ?)"
            biz_params = [like] * 3
            if org:
                biz_sql += """ AND (id=? OR EXISTS (SELECT 1 FROM connections x WHERE x.status='Connected' AND
                    ((x.requester=? AND x.target=businesses.id) OR (x.target=? AND x.requester=businesses.id))))"""
                biz_params += [org, org, org]
            biz_sql += " ORDER BY name LIMIT 5"
            for r in db.execute(biz_sql, biz_params):
                if len(results) >= limit: break
                results.append({
                    "type": "business", "id": r["id"], "title": r["name"],
                    "subtitle": " · ".join(x for x in (r["city"], r["gstin"]) if x) or "Business profile",
                    "meta": r["kind"], "detail": r["email"], "page": "connections",
                })
        return self.send_json(200, {"query": query, "count": len(results), "results": results})

    def static(self, name, content_type):
        path = ROOT / name
        if not path.is_file(): return self.send_json(404, {"error":"Not found"})
        content = path.read_bytes()
        compressed = len(content) > 1400 and self.accepts_gzip()
        etag = '"' + hashlib.sha1(content + (b"|gzip" if compressed else b"|identity")).hexdigest()[:20] + '"'
        if (self.headers.get("If-None-Match") or "") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.security_headers()
            self.end_headers()
            return
        body = gzip.compress(content, compresslevel=6) if compressed else content
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Vary", "Accept-Encoding")
        if body is not content: self.send_header("Content-Encoding", "gzip")
        self.security_headers()
        self.end_headers()
        if self.command != "HEAD":
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass
    def method_not_allowed(self):
        return self.send_json(405, {"error": "Method not allowed"})

    do_PUT = method_not_allowed
    do_DELETE = method_not_allowed
    do_OPTIONS = method_not_allowed

    def do_POST(self):
        try:
            data = self.body(); path = urlparse(self.path).path
            if path == "/api/invoices": return self.create_invoice(data)
            if path == "/api/businesses": return self.create_business(data)
            if path == "/api/bills": return self.create_bill(data)
            match = re.fullmatch(r"/api/invoices/([^/]+)/comments", path)
            if match: return self.add_comment(match.group(1), data)
            match = re.fullmatch(r"/api/connections/([^/]+)/status", path)
            if match: return self.connection_status(match.group(1), data)
            return self.send_json(404, {"error":"Not found"})
        except RequestTooLarge as e: return self.send_json(413, {"error":str(e)})
        except (ValueError, KeyError, TypeError) as e: return self.send_json(400, {"error":str(e)})
        except Exception:
            traceback.print_exc()
            return self.send_json(500, {"error":"The demo server hit an unexpected error"})
    def create_invoice(self, d):
        try:
            iid=clean_text(d.get("id"),"Invoice number",40)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*",iid): raise ValueError("Invoice number contains unsupported characters")
            customer=clean_text(d.get("customer"),"Customer",80)
            supplier=clean_text(d.get("supplier","northstar"),"Supplier",80)
            description=clean_text(d.get("description"),"Description",500)
            issue_date=iso_date(d.get("issue_date"),"Issue date")
            due_date=iso_date(d.get("due_date"),"Due date")
            if due_date<issue_date: raise ValueError("Due date can’t be before the issue date")
            qty=decimal_value(d.get("qty"),"Quantity",minimum=Decimal("0.01"),maximum=Decimal("1000000"))
            rate=decimal_value(d.get("rate"),"Rate",maximum=Decimal("10000000000"))
            tax=decimal_value(d.get("tax"),"GST rate",maximum=Decimal("100"))
            if tax not in {Decimal("0"),Decimal("5"),Decimal("12"),Decimal("18"),Decimal("28")}: raise ValueError("Choose a GST rate shown in the invoice form")
            po_number=clean_text(d.get("po_number",""),"Purchase order",100,required=False)
            total=(qty*rate*(Decimal("1")+tax/Decimal("100"))).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)
            if total>Decimal("1000000000000"): raise ValueError("Invoice total is above the demo limit")
            qty_value=float(qty); rate_value=float(rate); tax_value=float(tax); total_value=float(total)
        except (ValueError,TypeError) as e: return self.send_json(400,{"error":str(e)})
        stamp=now()
        with connect() as db:
            if db.execute("SELECT id FROM invoices WHERE id=?",(iid,)).fetchone(): return self.send_json(409,{"error":"Invoice number already exists"})
            biz=db.execute("SELECT * FROM businesses WHERE id=?",(customer,)).fetchone()
            if not biz: return self.send_json(400,{"error":"Choose a connected customer"})
            sup=db.execute("SELECT * FROM businesses WHERE id=?",(supplier,)).fetchone()
            if not sup: return self.send_json(400,{"error":"Supplier is not registered in this demo"})
            scopes=connection_scopes(db,supplier,biz['id'])
            if "exchange_invoices" not in scopes: return self.send_json(403,{"error":"Connect with this business and enable invoice sharing before sending"})
            db.execute("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(iid,supplier,biz["id"],sup["gstin"],biz["gstin"],issue_date,due_date,po_number,description,qty_value,rate_value,tax_value,total_value,"Sent","",stamp,stamp))
            db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(iid,supplier,"Invoice sent",biz["name"],stamp))
            bill_id="BILL-"+uuid.uuid4().hex[:8].upper()
            db.execute("INSERT INTO bills(id,buyer,vendor,vendor_invoice_id,received_date,due_date,po_number,description,amount,source,status,ocr_confidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(bill_id,biz["id"],supplier,iid,issue_date,due_date,po_number,description,total_value,"network","Received",1.0,stamp))
            db.execute("INSERT INTO bill_activity(bill_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(bill_id,supplier,"Bill received",f"Created from shared invoice {iid}",stamp))
        return self.send_json(201,{"ok":True,"total":total_value,"bill_id":bill_id})
    def add_comment(self, iid, d):
        body=str(d.get("body","")).strip()
        if not body: return self.send_json(400,{"error":"Write a reply first"})
        if len(body)>2000: return self.send_json(400,{"error":"Reply must be under 2,000 characters"})
        with connect() as db:
            invoice=db.execute("SELECT supplier,customer FROM invoices WHERE id=?",(iid,)).fetchone()
            if not invoice: return self.send_json(404,{"error":"Invoice not found"})
            actor=d.get("actor","northstar")
            if actor not in {invoice["supplier"],invoice["customer"]}: return self.send_json(403,{"error":"Only the invoice participants can reply"})
            if "exchange_invoices" not in connection_scopes(db,invoice["supplier"],invoice["customer"]): return self.send_json(403,{"error":"Invoice sharing is not active for this business pair"})
            stamp=now()
            db.execute("INSERT INTO comments(invoice_id,actor,body,created_at) VALUES(?,?,?,?)",(iid,actor,body,stamp))
            db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(iid,actor,"Comment added",body[:120],stamp))
        return self.send_json(201,{"ok":True})
    def create_business(self,d):
        name=str(d.get("name","")).strip(); email=str(d.get("email","")).strip()
        if not name or len(name)>120: return self.send_json(400,{"error":"Enter a business name (up to 120 characters)"})
        email=email[:160]
        gstin=str(d.get("gstin","")).strip().upper()
        requester=str(d.get("requester","northstar")).strip()
        scopes=d.get("scopes",["exchange_invoices","share_payment_status"])
        allowed_scopes={"exchange_invoices","share_payment_status"}
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email): return self.send_json(400,{"error":"Enter a valid business email"})
        if gstin and not re.fullmatch(r"[0-9]{2}[A-Z0-9]{13}",gstin): return self.send_json(400,{"error":"GSTIN must contain 15 letters and numbers"})
        if not isinstance(scopes,list) or not scopes or any(scope not in allowed_scopes for scope in scopes): return self.send_json(400,{"error":"Choose at least one supported sharing scope"})
        bid="biz_"+uuid.uuid4().hex[:10]; stamp=now()
        with connect() as db:
            if not db.execute("SELECT id FROM businesses WHERE id=?",(requester,)).fetchone(): return self.send_json(400,{"error":"Requesting business is not registered in this demo"})
            if gstin and db.execute("SELECT id FROM businesses WHERE gstin=?",(gstin,)).fetchone(): return self.send_json(409,{"error":"A business with this GSTIN is already in the demo network"})
            db.execute("INSERT INTO businesses VALUES(?,?,?,?,?,?,?)",(bid,name,"invited",str(d.get("city",""))[:80],gstin,email,stamp))
            db.execute("INSERT INTO connections VALUES(?,?,?,?,?,?,?)",("conn_"+uuid.uuid4().hex[:10],requester,bid,"Pending",json.dumps(scopes),stamp,stamp))
        return self.send_json(201,{"ok":True,"id":bid})
    def connection_status(self,cid,d):
        status=d.get("status")
        if status not in {"Connected","Declined","Revoked"}: return self.send_json(400,{"error":"Unsupported connection status"})
        with connect() as db:
            connection=db.execute("SELECT * FROM connections WHERE id=?",(cid,)).fetchone()
            if not connection: return self.send_json(404,{"error":"Connection not found"})
            actor=d.get("actor",connection["target"])
            if status in {"Connected","Declined"} and actor not in {connection["target"],connection["requester"]}: return self.send_json(403,{"error":"Only a connection participant can respond"})
            if status=="Revoked" and actor not in {connection["target"],connection["requester"]}: return self.send_json(403,{"error":"Only a connection participant can revoke it"})
            if status in {"Connected","Declined"} and connection["status"]!="Pending": return self.send_json(409,{"error":"This request is no longer pending"})
            if status=="Revoked" and connection["status"]!="Connected": return self.send_json(409,{"error":"Only an active connection can be revoked"})
            db.execute("UPDATE connections SET status=?,updated_at=? WHERE id=?",(status,now(),cid))
        return self.send_json(200,{"ok":True})
    def create_bill(self,d):
        try:
            vendor=clean_text(d.get("vendor"),"Vendor",80)
            reference=clean_text(d.get("vendor_invoice_id"),"Vendor invoice number",80)
            description=clean_text(d.get("description"),"Description",500)
            due_date=iso_date(d.get("due_date"),"Due date")
            received_date=iso_date(d.get("received_date",TODAY),"Received date")
            po_number=clean_text(d.get("po_number",""),"Purchase order",100,required=False)
            amount=float(decimal_money(d.get("amount"),"Bill amount"))
            source=clean_text(d.get("source","manual"),"Bill source",20)
            if source not in {"manual","upload"}: raise ValueError("Choose a supported bill source")
            confidence=decimal_value(d.get("ocr_confidence",0),"Extraction confidence",maximum=Decimal("1"))
            buyer=clean_text(d.get("buyer","meridian"),"Buyer",80)
        except (ValueError,TypeError) as e: return self.send_json(400,{"error":str(e)})
        bid="BILL-"+uuid.uuid4().hex[:8].upper()
        with connect() as db:
            if db.execute("SELECT id FROM bills WHERE buyer=? AND vendor=? AND vendor_invoice_id=? COLLATE NOCASE",(buyer,vendor,reference)).fetchone(): return self.send_json(409,{"error":"A bill with this vendor invoice number already exists"})
            if not db.execute("SELECT id FROM businesses WHERE id=?",(vendor,)).fetchone(): return self.send_json(400,{"error":"Choose a connected vendor"})
            if "exchange_invoices" not in connection_scopes(db,buyer,vendor): return self.send_json(403,{"error":"Connect with this vendor and enable invoice sharing before adding a bill"})
            db.execute("INSERT INTO bills VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(bid,buyer,vendor,reference,received_date,due_date,po_number,description,amount,source,"Received",float(confidence),now()))
            db.execute("INSERT INTO bill_activity(bill_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(bid,buyer,"Bill received",f"Added to AP inbox · {source} entry",now()))
        return self.send_json(201,{"ok":True,"id":bid})
    def log_message(self, *_): pass
    def do_PATCH(self):
        try:
            data=self.body(); path=urlparse(self.path).path
            match=re.fullmatch(r"/api/bills/([^/]+)/status",path)
            if match:
                status=data.get("status")
                if status not in {"Received","Needs approval","Approved","Rejected","Scheduled","Paid"}: return self.send_json(400,{"error":"Unsupported bill status"})
                with connect() as db:
                    bill=db.execute("SELECT * FROM bills WHERE id=?",(match.group(1),)).fetchone()
                    if not bill: return self.send_json(404,{"error":"Bill not found"})
                    if data.get("actor",bill["buyer"])!=bill["buyer"]: return self.send_json(403,{"error":"Only the buying business can update this bill"})
                    transitions={"Received":{"Needs approval"},"Needs approval":{"Approved","Rejected"},"Approved":{"Scheduled","Paid"},"Scheduled":{"Paid"},"Rejected":set(),"Paid":set()}
                    if status!=bill["status"] and status not in transitions.get(bill["status"],set()): return self.send_json(409,{"error":f"A bill can’t move from {bill['status']} to {status}"})
                    db.execute("UPDATE bills SET status=? WHERE id=?",(status,match.group(1)))
                    if status!=bill["status"]:
                        db.execute("INSERT INTO bill_activity(bill_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(bill["id"],data.get("actor",bill["buyer"]),"Bill status changed",f"{bill['status']} → {status}",now()))
                    linked_status={"Needs approval":"Pending approval","Approved":"Approved","Rejected":"Rejected","Paid":"Paid"}.get(status)
                    if bill["source"]=="network" and linked_status:
                        scopes=connection_scopes(db,bill["buyer"],bill["vendor"])
                        if "exchange_invoices" not in scopes or (status=="Paid" and "share_payment_status" not in scopes): linked_status=None
                    if bill["source"]=="network" and linked_status:
                        invoice=db.execute("SELECT id FROM invoices WHERE id=? AND supplier=? AND customer=?",(bill["vendor_invoice_id"],bill["vendor"],bill["buyer"])).fetchone()
                        if invoice:
                            db.execute("UPDATE invoices SET status=?,updated_at=? WHERE id=?",(linked_status,now(),invoice["id"]))
                            db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(invoice["id"],bill["buyer"],linked_status,"Bill workflow updated",now()))
                return self.send_json(200,{"ok":True})
            match=re.fullmatch(r"/api/invoices/([^/]+)/status",path)
            if match:
                status=data.get("status"); allowed={"Draft","Sent","Viewed","Pending approval","Approved","Partially paid","Paid","Overdue","Dispute","Resolved","Rejected"}
                if status not in allowed: return self.send_json(400,{"error":"Unsupported invoice status"})
                with connect() as db:
                    invoice=db.execute("SELECT * FROM invoices WHERE id=?",(match.group(1),)).fetchone()
                    if not invoice: return self.send_json(404,{"error":"Invoice not found"})
                    actor=data.get("actor",invoice["supplier"])
                    if actor not in {invoice["supplier"],invoice["customer"]}: return self.send_json(403,{"error":"Only the invoice participants can update its status"})
                    scopes=connection_scopes(db,invoice["supplier"],invoice["customer"])
                    if "exchange_invoices" not in scopes: return self.send_json(403,{"error":"Invoice sharing is not active for this business pair"})
                    if status in {"Paid","Partially paid"} and "share_payment_status" not in scopes: return self.send_json(403,{"error":"Payment status sharing is not enabled for this connection"})
                    transitions={"Draft":{"Sent"},"Sent":{"Viewed","Pending approval","Approved","Rejected","Dispute","Overdue"},"Viewed":{"Pending approval","Approved","Rejected","Dispute","Overdue"},"Pending approval":{"Approved","Rejected","Dispute"},"Approved":{"Partially paid","Paid","Dispute","Overdue"},"Partially paid":{"Paid","Dispute","Overdue"},"Overdue":{"Partially paid","Paid","Dispute","Approved"},"Dispute":{"Resolved"},"Resolved":{"Approved","Paid","Dispute"},"Rejected":set(),"Paid":set()}
                    if status!=invoice["status"] and status not in transitions.get(invoice["status"],set()): return self.send_json(409,{"error":f"An invoice can’t move from {invoice['status']} to {status}"})
                    reason=str(data.get("dispute_reason",""))[:500]
                    if reason: db.execute("UPDATE invoices SET status=?,dispute_reason=?,updated_at=? WHERE id=?",(status,reason,now(),match.group(1)))
                    else: db.execute("UPDATE invoices SET status=?,updated_at=? WHERE id=?",(status,now(),match.group(1)))
                    db.execute("INSERT INTO activity(invoice_id,actor,action,detail,created_at) VALUES(?,?,?,?,?)",(match.group(1),data.get("actor","northstar"),status,"Status updated",now()))
                    bill_status={"Pending approval":"Needs approval","Approved":"Approved","Paid":"Paid","Rejected":"Rejected"}.get(status)
                    if bill_status:
                        scopes=connection_scopes(db,invoice["supplier"],invoice["customer"])
                        if "exchange_invoices" in scopes and (status!="Paid" or "share_payment_status" in scopes):
                            db.execute("UPDATE bills SET status=? WHERE source='network' AND buyer=? AND vendor=? AND vendor_invoice_id=?",(bill_status,invoice["customer"],invoice["supplier"],invoice["id"]))
                return self.send_json(200,{"ok":True})
            return self.send_json(404,{"error":"Not found"})
        except RequestTooLarge as e: return self.send_json(413,{"error":str(e)})
        except (ValueError,KeyError,TypeError) as e: return self.send_json(400,{"error":str(e)})
        except Exception:
            traceback.print_exc()
            return self.send_json(500,{"error":"The demo server hit an unexpected error"})

if __name__ == "__main__":
    init_db()
    preferred=int(os.environ.get("INVOICEOS_PORT","8765"))
    server=None
    for port in range(preferred,preferred+20):
        try:
            server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
            break
        except OSError as e:
            if e.errno!=errno.EADDRINUSE: raise
    if server is None: raise RuntimeError(f"No available local port between {preferred} and {preferred+19}")
    print(f"InvoiceOS running at http://127.0.0.1:{port}")
    server.serve_forever()
