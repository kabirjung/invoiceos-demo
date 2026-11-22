"""InvoiceOS demo API core: framework-free request dispatcher backed by Supabase REST.

Used by api/index.py (Vercel serverless function) and server.py (local dev).
Stdlib only. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only).
"""
import datetime
import json
import os
import re
import time
import traceback
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import parse_qs, unquote, urlencode, urlparse

VERSION = "2.0.0"
MAX_BODY = 100_000
ORG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
INVOICE_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,39}")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def today():
    return datetime.date.today().isoformat()


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


# --------------------------------------------------------------------------- Supabase


class SB:
    """Tiny PostgREST client. Every filter value is URL-encoded; group filters use pgq()."""

    def __init__(self):
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            print("InvoiceOS: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
            raise ApiError(503, "The demo data service is not configured")
        self.base = url + "/rest/v1"
        self.h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    def _req(self, method, table, params=None, body=None, prefer=None):
        url = f"{self.base}/{table}"
        if params:
            url += "?" + urlencode([(k, str(v)) for k, v in params.items() if v is not None])
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = dict(self.h)
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = resp.read()
                return json.loads(raw.decode()) if raw else None
        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode()[:300]
            except Exception:
                detail = ""
            print(f"InvoiceOS: Supabase {method} {table} -> {e.code} {detail}")
            raise ApiError(409 if e.code == 409 else 502, "The demo database rejected the request")
        except Exception as e:
            print(f"InvoiceOS: Supabase {method} {table} failed: {e}")
            raise ApiError(502, "The demo database is unreachable")

    def select(self, table, columns="*", filters=None, order=None, limit=None):
        params = {"select": columns}
        params.update(filters or {})
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = limit
        return self._req("GET", table, params) or []

    def one(self, table, columns="*", filters=None):
        rows = self.select(table, columns, filters, limit=1)
        return rows[0] if rows else None

    def insert(self, table, data):
        return self._req("POST", table, body=data, prefer="return=representation")

    def update(self, table, filters, data):
        return self._req("PATCH", table, params=filters, body=data, prefer="return=representation") or []


def make_db():
    if os.environ.get("INVOICEOS_LOCAL") == "1":
        from _local import LocalDB
        return LocalDB()
    return SB()


def eq(value):
    return "eq." + str(value)


def pgq(value):
    """Quote a literal for use inside a PostgREST and()/or() group."""
    s = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return '"' + s + '"'


# --------------------------------------------------------------------------- validation


def clean_text(value, label, limit, required=True):
    if value is not None and not isinstance(value, (str, int, float)):
        raise ApiError(400, f"{label} is not valid")
    value = str(value if value is not None else "").strip()
    if required and not value:
        raise ApiError(400, f"{label} is required")
    if len(value) > limit:
        raise ApiError(400, f"{label} must be {limit} characters or fewer")
    return value


def org_id(value, label):
    value = clean_text(value, label, 80)
    if not ORG_RE.fullmatch(value):
        raise ApiError(400, f"{label} is not valid")
    return value


def iso_date(value, label):
    value = clean_text(value, label, 10)
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, f"{label} must be a valid date")
    return value


def decimal_value(value, label, *, minimum=Decimal("0"), maximum=Decimal("1000000000000")):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ApiError(400, f"{label} must be a valid number")
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ApiError(400, f"{label} must be a valid number")
    if not number.is_finite() or number < minimum or number > maximum:
        raise ApiError(400, f"Check the {label.lower()} value")
    return number


def money(value, label):
    number = decimal_value(value, label).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if number <= 0:
        raise ApiError(400, f"{label} must be greater than zero")
    return number


def connection_scopes(sb, first, second):
    rows = sb.select(
        "connections",
        "scopes",
        filters={
            "or": f"(and(requester.eq.{pgq(first)},target.eq.{pgq(second)}),"
            f"and(requester.eq.{pgq(second)},target.eq.{pgq(first)}))",
            "status": eq("Connected"),
        },
        order="updated_at.desc",
        limit=1,
    )
    if not rows:
        return set()
    try:
        return set(json.loads(rows[0]["scopes"]))
    except (ValueError, TypeError, KeyError):
        return set()


# --------------------------------------------------------------------------- handlers


def bootstrap(sb):
    jobs = {
        "businesses": ("businesses", "name.asc"),
        "invoices": ("invoices", "created_at.desc"),
        "comments": ("comments", "created_at.asc"),
        "activity": ("activity", "created_at.desc"),
        "bills": ("bills", "created_at.desc"),
        "bill_activity": ("bill_activity", "created_at.desc"),
        "connections": ("connections", "created_at.desc"),
    }
    jobs["calendar_events"] = ("calendar_events", "start_date.asc,start_time.asc")
    jobs["staff"] = ("staff", "name.asc")
    jobs["reminders"] = ("reminders", "created_at.desc")
    jobs["payment_runs"] = ("payment_runs", "created_at.desc")
    jobs["payment_run_items"] = ("payment_run_items", "created_at.asc")
    jobs["org_settings"] = ("org_settings", "org.asc")
    # optional until migrations 003 / 004 are applied
    optional = {"calendar_events", "staff", "reminders", "payment_runs", "payment_run_items", "org_settings"}
    with ThreadPoolExecutor(max_workers=13) as pool:
        futures = {k: pool.submit(sb.select, t, "*", None, o) for k, (t, o) in jobs.items()}
        out = {}
        for k, f in futures.items():
            try:
                out[k] = f.result()
            except ApiError:
                if k not in optional:
                    raise
                out[k] = []
        return 200, out


def health(sb):
    sb.select("businesses", "id", limit=1)
    return 200, {"ok": True, "service": "InvoiceOS demo", "version": VERSION, "time": now()}


def search(sb, query):
    q = (query.get("q", [""])[0] or "").strip()[:80]
    try:
        limit = max(1, min(25, int(query.get("limit", ["12"])[0])))
    except (TypeError, ValueError):
        limit = 12
    org = (query.get("org", [""])[0] or "").strip()
    if not q:
        return 200, {"query": "", "count": 0, "results": []}
    if not ORG_RE.fullmatch(org):
        raise ApiError(400, "Pick a role before searching")
    needle = q.lower()

    def hit(*vals):
        return any(needle in str(v or "").lower() for v in vals)

    businesses = {b["id"]: b for b in sb.select("businesses", "*")}
    name = lambda i: (businesses.get(i) or {}).get("name", i)
    results = []
    invoices = sb.select(
        "invoices", "*",
        filters={"or": f"(supplier.eq.{pgq(org)},customer.eq.{pgq(org)})"},
        order="updated_at.desc,id.asc",
    )
    for r in invoices:
        if hit(r["id"], r["description"], r["po_number"], name(r["supplier"]), name(r["customer"])):
            results.append({
                "type": "invoice", "id": r["id"], "title": r["id"],
                "subtitle": f"{name(r['supplier'])} → {name(r['customer'])}",
                "meta": r["status"], "detail": r["description"], "amount": r["total"],
                "date": r["due_date"], "page": "detail",
            })
    bills = sb.select(
        "bills", "*",
        filters={"or": f"(buyer.eq.{pgq(org)},vendor.eq.{pgq(org)})"},
        order="created_at.desc,id.asc",
    )
    for r in bills:
        if hit(r["id"], r["description"], r["vendor_invoice_id"], r["po_number"], name(r["vendor"])):
            results.append({
                "type": "bill", "id": r["id"], "title": r["id"],
                "subtitle": f"{name(r['vendor'])} · {r['vendor_invoice_id']}",
                "meta": r["status"], "detail": r["description"], "amount": r["amount"],
                "date": r["due_date"], "page": "bills",
            })
    visible = {org}
    for c in sb.select(
        "connections", "requester,target",
        filters={"or": f"(requester.eq.{pgq(org)},target.eq.{pgq(org)})"},
    ):
        visible.update((c["requester"], c["target"]))
    for b in businesses.values():
        if b["id"] in visible and hit(b["name"], b["city"], b["gstin"]):
            results.append({
                "type": "business", "id": b["id"], "title": b["name"],
                "subtitle": " · ".join(x for x in (b.get("city"), b.get("gstin")) if x) or "Business profile",
                "meta": b["kind"], "detail": b.get("email", ""), "page": "connections",
            })
    results = results[:limit]
    return 200, {"query": q, "count": len(results), "results": results}


def create_invoice(sb, d):
    iid = clean_text(d.get("id"), "Invoice number", 40)
    if not INVOICE_ID_RE.fullmatch(iid):
        raise ApiError(400, "Invoice number can use letters, numbers, dots, dashes and underscores")
    customer = org_id(d.get("customer"), "Customer")
    supplier = org_id(d.get("supplier"), "Supplier")
    description = clean_text(d.get("description"), "Description", 500)
    issue_date = iso_date(d.get("issue_date"), "Issue date")
    due_date = iso_date(d.get("due_date"), "Due date")
    if due_date < issue_date:
        raise ApiError(400, "Due date can't be before the issue date")
    qty = decimal_value(d.get("qty"), "Quantity", minimum=Decimal("0.01"), maximum=Decimal("1000000"))
    rate = decimal_value(d.get("rate"), "Rate", maximum=Decimal("10000000"))
    tax = decimal_value(d.get("tax"), "GST rate", maximum=Decimal("100"))
    if tax not in {Decimal(x) for x in ("0", "5", "12", "18", "28")}:
        raise ApiError(400, "Choose a GST rate shown in the invoice form")
    po_number = clean_text(d.get("po_number", ""), "Purchase order", 100, required=False)
    total = (qty * rate * (1 + tax / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if total <= 0:
        raise ApiError(400, "Invoice total must be greater than zero")
    if total > Decimal("1000000000"):
        raise ApiError(400, "Invoice total is above the demo limit")
    if supplier == customer:
        raise ApiError(400, "Supplier and customer must be different businesses")

    if sb.one("invoices", "id", {"id": eq(iid)}):
        raise ApiError(409, "Invoice number already exists")
    # The buyer's bill inbox treats references case-insensitively, so reject before writing anything.
    for row in sb.select("bills", "vendor_invoice_id", {"buyer": eq(customer), "vendor": eq(supplier)}):
        if row["vendor_invoice_id"].strip().lower() == iid.lower():
            raise ApiError(409, "Invoice number already exists")
    biz = sb.one("businesses", "*", {"id": eq(customer)})
    if not biz:
        raise ApiError(400, "Choose a connected customer")
    sup = sb.one("businesses", "*", {"id": eq(supplier)})
    if not sup:
        raise ApiError(400, "Supplier is not registered in this demo")
    if "exchange_invoices" not in connection_scopes(sb, supplier, customer):
        raise ApiError(403, "Connect with this business and enable invoice sharing before sending")

    stamp = now()
    bill_id = "BILL-" + uuid.uuid4().hex[:8].upper()
    sb.insert("invoices", {
        "id": iid, "supplier": supplier, "customer": customer,
        "supplier_gstin": sup["gstin"], "customer_gstin": biz["gstin"],
        "issue_date": issue_date, "due_date": due_date, "po_number": po_number,
        "description": description, "qty": str(qty), "rate": str(rate), "tax": str(tax),
        "total": str(total), "status": "Sent", "dispute_reason": "",
        "created_at": stamp, "updated_at": stamp,
    })
    sb.insert("activity", {"invoice_id": iid, "actor": supplier, "action": "Invoice sent",
                           "detail": biz["name"], "created_at": stamp})
    sb.insert("bills", {
        "id": bill_id, "buyer": customer, "vendor": supplier, "vendor_invoice_id": iid,
        "received_date": issue_date, "due_date": due_date, "po_number": po_number,
        "description": description, "amount": str(total), "source": "network",
        "status": "Received", "ocr_confidence": 1.0, "created_at": stamp,
    })
    sb.insert("bill_activity", {"bill_id": bill_id, "actor": supplier, "action": "Bill received",
                                "detail": f"Created from shared invoice {iid}", "created_at": stamp})
    notify(sb, customer, f"New invoice from {sup['name']}", f"{iid} · {description[:80]}", "invoice", "", "bills", bill_id)
    return 201, {"ok": True, "total": float(total), "bill_id": bill_id}


def add_comment(sb, iid, d):
    body_text = clean_text(d.get("body"), "Reply", 2000)
    actor = org_id(d.get("actor"), "Actor")
    inv = sb.one("invoices", "supplier,customer", {"id": eq(iid)})
    if not inv:
        raise ApiError(404, "Invoice not found")
    if actor not in {inv["supplier"], inv["customer"]}:
        raise ApiError(403, "Only the invoice participants can reply")
    if "exchange_invoices" not in connection_scopes(sb, inv["supplier"], inv["customer"]):
        raise ApiError(403, "Invoice sharing is not active for this business pair")
    stamp = now()
    sb.insert("comments", {"invoice_id": iid, "actor": actor, "body": body_text, "created_at": stamp})
    sb.insert("activity", {"invoice_id": iid, "actor": actor, "action": "Comment added",
                           "detail": body_text[:120], "created_at": stamp})
    other = inv["customer"] if actor == inv["supplier"] else inv["supplier"]
    notify(sb, other, f"{biz_name(sb, actor)} replied on {iid}", body_text[:120], "comment", "", "detail", iid)
    return 201, {"ok": True}


def create_business(sb, d):
    name = clean_text(d.get("name"), "Business name", 120)
    email = clean_text(d.get("email", ""), "Business email", 160, required=False)
    gstin = clean_text(d.get("gstin", ""), "GSTIN", 15, required=False).upper()
    requester = org_id(d.get("requester"), "Requester")
    city = clean_text(d.get("city", ""), "City", 80, required=False)
    scopes = d.get("scopes", ["exchange_invoices", "share_payment_status"])
    allowed = {"exchange_invoices", "share_payment_status"}
    if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ApiError(400, "Enter a valid business email")
    if gstin and not re.fullmatch(r"[0-9]{2}[A-Z0-9]{13}", gstin):
        raise ApiError(400, "GSTIN must contain 15 letters and numbers")
    if not isinstance(scopes, list) or not scopes or any(not isinstance(s, str) or s not in allowed for s in scopes):
        raise ApiError(400, "Choose at least one supported sharing scope")
    scopes = sorted(set(scopes))
    if not sb.one("businesses", "id", {"id": eq(requester)}):
        raise ApiError(400, "Requesting business is not registered in this demo")
    if gstin and sb.one("businesses", "id", {"gstin": eq(gstin)}):
        raise ApiError(409, "A business with this GSTIN is already in the demo network")
    bid = "biz_" + uuid.uuid4().hex[:10]
    stamp = now()
    sb.insert("businesses", {"id": bid, "name": name, "kind": "invited", "city": city,
                             "gstin": gstin, "email": email, "created_at": stamp})
    sb.insert("connections", {"id": "conn_" + uuid.uuid4().hex[:10], "requester": requester,
                              "target": bid, "status": "Pending", "scopes": json.dumps(scopes),
                              "created_at": stamp, "updated_at": stamp})
    return 201, {"ok": True, "id": bid}


def connection_status(sb, cid, d):
    status = d.get("status")
    if status not in {"Connected", "Declined", "Revoked"}:
        raise ApiError(400, "Unsupported connection status")
    actor = org_id(d.get("actor"), "Actor")
    conn = sb.one("connections", "*", {"id": eq(cid)})
    if not conn:
        raise ApiError(404, "Connection not found")
    if actor not in {conn["target"], conn["requester"]}:
        raise ApiError(403, "Only a connection participant can change it")
    if status in {"Connected", "Declined"} and conn["status"] != "Pending":
        raise ApiError(409, "This request is no longer pending")
    if status == "Revoked" and conn["status"] != "Connected":
        raise ApiError(409, "Only an active connection can be revoked")
    rows = sb.update("connections", {"id": eq(cid), "status": eq(conn["status"])},
                     {"status": status, "updated_at": now()})
    if not rows:
        raise ApiError(409, "This connection changed. Refresh and try again")
    return 200, {"ok": True}


def create_bill(sb, d):
    vendor = org_id(d.get("vendor"), "Vendor")
    reference = clean_text(d.get("vendor_invoice_id"), "Vendor invoice number", 80)
    description = clean_text(d.get("description"), "Description", 500)
    due_date = iso_date(d.get("due_date"), "Due date")
    received_date = iso_date(d.get("received_date", today()), "Received date")
    po_number = clean_text(d.get("po_number", ""), "Purchase order", 100, required=False)
    amount = money(d.get("amount"), "Bill amount")
    if amount > Decimal("1000000000"):
        raise ApiError(400, "Bill amount is above the demo limit")
    source = clean_text(d.get("source", "manual"), "Bill source", 20)
    if source not in {"manual", "upload"}:
        raise ApiError(400, "Choose a supported bill source")
    confidence = decimal_value(d.get("ocr_confidence", 0), "Extraction confidence", maximum=Decimal("1"))
    buyer = org_id(d.get("buyer"), "Buyer")

    for row in sb.select("bills", "vendor_invoice_id", {"buyer": eq(buyer), "vendor": eq(vendor)}):
        if row["vendor_invoice_id"].strip().lower() == reference.lower():
            raise ApiError(409, "A bill with this vendor invoice number already exists")
    if not sb.one("businesses", "id", {"id": eq(vendor)}):
        raise ApiError(400, "Choose a connected vendor")
    if not sb.one("businesses", "id", {"id": eq(buyer)}):
        raise ApiError(400, "Buyer is not registered in this demo")
    if "exchange_invoices" not in connection_scopes(sb, buyer, vendor):
        raise ApiError(403, "Connect with this vendor and enable invoice sharing before adding a bill")
    bid = "BILL-" + uuid.uuid4().hex[:8].upper()
    stamp = now()
    sb.insert("bills", {
        "id": bid, "buyer": buyer, "vendor": vendor, "vendor_invoice_id": reference,
        "received_date": received_date, "due_date": due_date, "po_number": po_number,
        "description": description, "amount": str(amount), "source": source,
        "status": "Received", "ocr_confidence": float(confidence), "created_at": stamp,
    })
    sb.insert("bill_activity", {"bill_id": bid, "actor": buyer, "action": "Bill received",
                                "detail": f"Added to AP inbox · {source} entry", "created_at": stamp})
    return 201, {"ok": True, "id": bid}


BILL_TRANSITIONS = {
    "Received": {"Needs approval"},
    "Needs approval": {"Approved", "Rejected"},
    "Approved": {"Scheduled", "Paid"},
    "Scheduled": {"Paid"},
    "Rejected": set(),
    "Paid": set(),
}

INVOICE_TRANSITIONS = {
    "Draft": {"Sent"},
    "Sent": {"Viewed", "Pending approval", "Approved", "Rejected", "Dispute", "Overdue"},
    "Viewed": {"Pending approval", "Approved", "Rejected", "Dispute", "Overdue"},
    "Pending approval": {"Approved", "Rejected", "Dispute"},
    "Approved": {"Partially paid", "Paid", "Dispute", "Overdue"},
    "Partially paid": {"Paid", "Dispute", "Overdue"},
    "Overdue": {"Partially paid", "Paid", "Dispute", "Approved"},
    "Dispute": {"Resolved"},
    "Resolved": {"Approved", "Paid", "Dispute"},
    "Rejected": set(),
    "Paid": set(),
}
# Only the buying business can review, approve, reject or query an invoice.
BUYER_ONLY = {"Viewed", "Pending approval", "Approved", "Rejected", "Dispute"}


def patch_bill_status(sb, bid, d):
    status = d.get("status")
    if status not in BILL_TRANSITIONS:
        raise ApiError(400, "Unsupported bill status")
    actor = org_id(d.get("actor"), "Actor")
    bill = sb.one("bills", "*", {"id": eq(bid)})
    if not bill:
        raise ApiError(404, "Bill not found")
    if actor != bill["buyer"]:
        raise ApiError(403, "Only the buying business can update this bill")
    if status == bill["status"]:
        return 200, {"ok": True}
    if status not in BILL_TRANSITIONS[bill["status"]]:
        raise ApiError(409, f"A bill can't move from {bill['status']} to {status}")
    if status == "Approved":
        limit = approval_threshold(sb, bill["buyer"])
        if limit and Decimal(str(bill["amount"])) > limit and d.get("role") != "approver":
            raise ApiError(403, f"Bills above {inr(limit)} need the approver (approval rule)")
    bill_patch = {"status": status}
    if status == "Paid":
        bill_patch["paid_date"] = today()
    rows = sb.update("bills", {"id": eq(bid), "status": eq(bill["status"])}, bill_patch)
    if not rows:
        raise ApiError(409, "This bill changed. Refresh and try again")
    stamp = now()
    sb.insert("bill_activity", {"bill_id": bid, "actor": actor, "action": "Bill status changed",
                                "detail": f"{bill['status']} → {status}", "created_at": stamp})
    if status == "Needs approval":
        notify(sb, bill["buyer"], f"{bid} needs your approval", f"{biz_name(sb, bill['vendor'])} · {inr(bill['amount'])}",
               "approval", "approver", "bills", bid)
    elif status in ("Approved", "Rejected"):
        notify(sb, bill["buyer"], f"{bid} {status.lower()}", f"{biz_name(sb, bill['vendor'])} · {inr(bill['amount'])}",
               "approval", "ap", "bills", bid)
    linked = {"Needs approval": "Pending approval", "Approved": "Approved", "Rejected": "Rejected", "Paid": "Paid"}.get(status)
    if bill["source"] == "network" and linked:
        scopes = connection_scopes(sb, bill["buyer"], bill["vendor"])
        if "exchange_invoices" in scopes and (status != "Paid" or "share_payment_status" in scopes):
            inv = sb.one("invoices", "id,status", {"id": eq(bill["vendor_invoice_id"]),
                                                   "supplier": eq(bill["vendor"]), "customer": eq(bill["buyer"])})
            # Respect invoice rules: never overwrite a dispute, rejection or payment with a bill update.
            if inv and (linked == inv["status"] or linked in INVOICE_TRANSITIONS.get(inv["status"], set())):
                inv_patch = {"status": linked, "updated_at": stamp}
                if linked == "Paid":
                    inv_patch.update(paid_date=today(), amount_paid=str(bill["amount"]))
                sb.update("invoices", {"id": eq(inv["id"])}, inv_patch)
                sb.insert("activity", {"invoice_id": inv["id"], "actor": bill["buyer"], "action": linked,
                                       "detail": "Bill workflow updated", "created_at": stamp})
                if linked != inv["status"]:
                    notify(sb, bill["vendor"], f"{biz_name(sb, bill['buyer'])} marked {inv['id']} {linked.lower()}",
                           "Synced from the buyer's bill workflow" + (" (demo payment, no money moved)" if linked == "Paid" else ""),
                           "payment" if linked == "Paid" else "status", "", "detail", inv["id"])
    return 200, {"ok": True}


def patch_invoice_status(sb, iid, d):
    status = d.get("status")
    if status not in INVOICE_TRANSITIONS:
        raise ApiError(400, "Unsupported invoice status")
    actor = org_id(d.get("actor"), "Actor")
    reason = d.get("dispute_reason", "")
    if not isinstance(reason, str):
        raise ApiError(400, "Dispute reason is not valid")
    if len(reason) > 500:
        raise ApiError(400, "Dispute reason must be 500 characters or fewer")
    inv = sb.one("invoices", "*", {"id": eq(iid)})
    if not inv:
        raise ApiError(404, "Invoice not found")
    if actor not in {inv["supplier"], inv["customer"]}:
        raise ApiError(403, "Only the invoice participants can update its status")
    if status in BUYER_ONLY and actor != inv["customer"]:
        raise ApiError(403, "Only the buyer can review, approve, reject or query an invoice")
    scopes = connection_scopes(sb, inv["supplier"], inv["customer"])
    if "exchange_invoices" not in scopes:
        raise ApiError(403, "Invoice sharing is not active for this business pair")
    if status in {"Paid", "Partially paid"} and "share_payment_status" not in scopes:
        raise ApiError(403, "Payment status sharing is not enabled for this connection")
    if status == inv["status"]:
        return 200, {"ok": True}
    if status not in INVOICE_TRANSITIONS[inv["status"]]:
        raise ApiError(409, f"An invoice can't move from {inv['status']} to {status}")
    stamp = now()
    patch = {"status": status, "updated_at": stamp}
    if reason.strip():
        patch["dispute_reason"] = reason.strip()
    elif status == "Resolved":
        patch["dispute_reason"] = ""
    if status == "Paid":
        patch.update(paid_date=today(), amount_paid=str(inv["total"]))
    rows = sb.update("invoices", {"id": eq(iid), "status": eq(inv["status"])}, patch)
    if not rows:
        raise ApiError(409, "This invoice changed. Refresh and try again")
    sb.insert("activity", {"invoice_id": iid, "actor": actor, "action": status,
                           "detail": "Status updated", "created_at": stamp})
    other = inv["customer"] if actor == inv["supplier"] else inv["supplier"]
    kind = {"Dispute": "dispute", "Paid": "payment", "Partially paid": "payment", "Viewed": "view"}.get(status, "status")
    what = {"Dispute": f"raised a query on {iid}", "Viewed": f"viewed {iid}"}.get(status, f"marked {iid} {status.lower()}")
    notify(sb, other, f"{biz_name(sb, actor)} {what}", (reason.strip() or "Status updated on the shared invoice")[:120],
           kind, "", "detail", iid)
    bill_status = {"Pending approval": "Needs approval", "Approved": "Approved", "Paid": "Paid", "Rejected": "Rejected"}.get(status)
    if bill_status and (status != "Paid" or "share_payment_status" in scopes):
        linked_bill = sb.one("bills", "id,status", {"source": eq("network"), "buyer": eq(inv["customer"]),
                                                    "vendor": eq(inv["supplier"]), "vendor_invoice_id": eq(iid)})
        # Move the bill forward only; never revive a paid/rejected bill or step it backwards.
        rank = {"Received": 0, "Needs approval": 1, "Approved": 2, "Scheduled": 3, "Paid": 4}
        if linked_bill and linked_bill["status"] in rank and (
                rank[bill_status] > rank[linked_bill["status"]] or
                (bill_status == "Rejected" and linked_bill["status"] != "Paid")):
            if sb.update("bills", {"id": eq(linked_bill["id"]), "status": eq(linked_bill["status"])},
                         {"status": bill_status}):
                sb.insert("bill_activity", {"bill_id": linked_bill["id"], "actor": actor, "action": "Bill status changed",
                                            "detail": f"{linked_bill['status']} → {bill_status} (invoice updated)",
                                            "created_at": stamp})
    return 200, {"ok": True}


# --------------------------------------------------------------------------- calendar

# Demo roles. Each internal role maps to one fictional person in the `staff` table.
# Authorities schedule meetings and assign work; employees receive work.
ROLES = {
    "owner": {"org": "northstar", "authority": True},
    "finance_manager": {"org": "northstar", "authority": True},
    "ar": {"org": "northstar", "authority": False},
    "auditor": {"org": "northstar", "authority": False, "read_only": True},
    "approver": {"org": "meridian", "authority": True},
    "ap": {"org": "meridian", "authority": False},
}
TASK_STATUSES = {"Open", "In progress", "Done"}
ASSIGNEE_MOVES = {("Open", "In progress"), ("In progress", "Done"), ("Done", "In progress")}
TIME_RE = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def calendar_actor(sb, d, org=None):
    """Validate the demo-declared role + actor pair and resolve the person. Returns (role, info, person)."""
    role = d.get("role")
    if not isinstance(role, str) or role not in ROLES:
        raise ApiError(403, "This role does not have calendar access")
    actor = org_id(d.get("actor"), "Actor")
    info = ROLES[role]
    if info["org"] != actor or (org is not None and org != actor):
        raise ApiError(403, "This role does not belong to that business")
    person = sb.one("staff", "*", {"org": eq(actor), "role_key": eq(role)})
    if not person:
        raise ApiError(403, "No staff member is set up for this role")
    return role, info, person


def org_staff(sb, org):
    return sb.select("staff", "*", {"org": eq(org)}, order="name.asc")


def get_calendar(sb, query):
    org = (query.get("org", [""])[0] or "").strip()
    role = (query.get("role", [""])[0] or "").strip()
    if not ORG_RE.fullmatch(org):
        raise ApiError(400, "Business is required")
    calendar_actor(sb, {"role": role, "actor": org}, org)
    rows = sb.select("calendar_events", "*", {"org": eq(org)}, order="start_date.asc,start_time.asc")
    return 200, {"events": rows, "staff": org_staff(sb, org)}


def create_event(sb, d):
    role, info, person = calendar_actor(sb, d)
    if not info["authority"]:
        raise ApiError(403, "Only owners, finance managers and approvers can schedule or assign")
    org = info["org"]
    kind = d.get("kind")
    if kind not in ("meeting", "task"):
        raise ApiError(400, "Choose meeting or task")
    title = clean_text(d.get("title"), "Title", 120)
    description = clean_text(d.get("description", ""), "Description", 500, required=False)
    staff = {p["id"]: p for p in org_staff(sb, org)}
    stamp = now()
    row = {"id": "evt_" + uuid.uuid4().hex[:10], "org": org, "kind": kind, "title": title,
           "description": description, "start_time": "", "end_time": "", "due_date": "",
           "attendees": "[]", "assignee_staff": "", "created_by_staff": person["id"],
           "priority": "Normal", "created_at": stamp, "updated_at": stamp}
    if kind == "meeting":
        start = iso_date(d.get("start_date"), "Meeting date")
        if start < today():
            raise ApiError(400, "Meetings can't be scheduled in the past")
        st = clean_text(d.get("start_time"), "Start time", 5)
        et = clean_text(d.get("end_time"), "End time", 5)
        if not TIME_RE.fullmatch(st) or not TIME_RE.fullmatch(et):
            raise ApiError(400, "Times must look like 14:30")
        if et <= st:
            raise ApiError(400, "End time must be after the start time")
        attendees = d.get("attendees", [])
        if not isinstance(attendees, list) or any(not isinstance(a, str) or a not in staff for a in attendees):
            raise ApiError(400, "Choose attendees from this business")
        attendees = sorted(set(attendees) | {person["id"]})
        row.update(start_date=start, start_time=st, end_time=et, attendees=json.dumps(attendees), status="Scheduled")
    else:
        due = iso_date(d.get("due_date"), "Deadline")
        if due < today():
            raise ApiError(400, "The deadline can't be in the past")
        if due > (datetime.date.today() + datetime.timedelta(days=730)).isoformat():
            raise ApiError(400, "Choose a deadline within two years")
        assignee = d.get("assignee_staff")
        if not isinstance(assignee, str) or assignee not in staff or ROLES.get(staff[assignee]["role_key"], {}).get("authority", True):
            raise ApiError(400, "Choose an employee from this business")
        priority = d.get("priority", "Normal")
        if priority not in ("Normal", "High"):
            raise ApiError(400, "Priority must be Normal or High")
        row.update(start_date=today(), due_date=due, assignee_staff=assignee, priority=priority, status="Open")
    sb.insert("calendar_events", row)
    if kind == "task":
        notify(sb, org, "New work assigned to you", f"{title} · due {due} · from {person['name']}", "task",
               staff[row["assignee_staff"]]["role_key"], "calendar", row["id"])
    else:
        roles = sorted({staff[a]["role_key"] for a in json.loads(row["attendees"]) if a != person["id"]})
        if roles:
            notify(sb, org, f"Meeting: {title}", f"{row['start_date']} {row['start_time']} · from {person['name']}",
                   "meeting", ",".join(roles), "calendar", row["id"])
    return 201, {"ok": True, "id": row["id"]}


def patch_event(sb, eid, d):
    role, info, person = calendar_actor(sb, d)
    ev = sb.one("calendar_events", "*", {"id": eq(eid)})
    if not ev or ev["org"] != info["org"]:
        raise ApiError(404, "Calendar item not found")
    patch = {}
    new_status = d.get("status")
    if info["authority"]:
        if ev["kind"] == "meeting":
            if new_status not in (None, ev["status"]):
                if new_status != "Cancelled" or ev["status"] != "Scheduled":
                    raise ApiError(409, "A scheduled meeting can only be cancelled")
                patch["status"] = "Cancelled"
        else:
            if new_status is not None and new_status not in TASK_STATUSES:
                raise ApiError(400, "Unsupported task status")
            if new_status not in (None, ev["status"]):
                patch["status"] = new_status
            if "due_date" in d:
                due = iso_date(d.get("due_date"), "Deadline")
                if due != ev["due_date"] and due < today():
                    raise ApiError(400, "The deadline can't be in the past")
                patch["due_date"] = due
            if "assignee_staff" in d:
                a = d.get("assignee_staff")
                staff = {p["id"]: p for p in org_staff(sb, ev["org"])}
                if not isinstance(a, str) or a not in staff or ROLES.get(staff[a]["role_key"], {}).get("authority", True):
                    raise ApiError(400, "Choose an employee from this business")
                patch["assignee_staff"] = a
            if "priority" in d:
                if d.get("priority") not in ("Normal", "High"):
                    raise ApiError(400, "Priority must be Normal or High")
                patch["priority"] = d["priority"]
    else:
        if ev["kind"] != "task" or ev["assignee_staff"] != person["id"]:
            raise ApiError(403, "Only the assigned employee can update this task")
        if info.get("read_only"):
            raise ApiError(403, "This role is read only")
        if set(d) - {"role", "actor", "status"}:
            raise ApiError(403, "Employees can only update the status of their own task")
        if new_status not in TASK_STATUSES:
            raise ApiError(400, "Unsupported task status")
        if new_status != ev["status"]:
            if (ev["status"], new_status) not in ASSIGNEE_MOVES:
                raise ApiError(409, f"A task can't move from {ev['status']} to {new_status}")
            patch["status"] = new_status
    if not patch:
        return 200, {"ok": True}
    patch["updated_at"] = now()
    rows = sb.update("calendar_events", {"id": eq(eid), "status": eq(ev["status"])}, patch)
    if not rows:
        raise ApiError(409, "This item changed. Refresh and try again")
    if ev["kind"] == "task":
        staff = {p["id"]: p for p in org_staff(sb, ev["org"])}
        if not info["authority"] and "status" in patch and ev["created_by_staff"] in staff:
            notify(sb, ev["org"], f"{person['name']} moved a task to {patch['status']}", ev["title"], "task",
                   staff[ev["created_by_staff"]]["role_key"], "calendar", eid)
        elif info["authority"] and patch.get("assignee_staff") and patch["assignee_staff"] != ev["assignee_staff"]:
            notify(sb, ev["org"], "New work assigned to you", f"{ev['title']} · from {person['name']}", "task",
                   staff[patch["assignee_staff"]]["role_key"], "calendar", eid)



# --------------------------------------------------------------------------- business features
# Notifications, cash-flow forecast, collections, payment runs, partner scorecards, approval rule, audit pack.
# Everything is computed from stored rows. Nothing here sends email or moves money.

OPEN_AR = {"Sent", "Viewed", "Pending approval", "Approved", "Partially paid", "Overdue", "Resolved"}
OPEN_AP = {"Received", "Needs approval", "Approved", "Scheduled"}
TONES = ("gentle", "firm", "final")
REMINDER_TEXT = {
    "gentle": "Hi {name} team, a friendly note that {iid} for {amount} was due on {due}. Could you share an expected payment date? Thank you.",
    "firm": "Hello {name} team, {iid} for {amount} is now {late} days past due. Please arrange payment or tell us what is holding it up this week.",
    "final": "Dear {name} team, {iid} for {amount} is {late} days overdue despite earlier reminders. Please settle it within 7 days so we can keep your account in good standing.",
    "upcoming": "Hi {name} team, {iid} for {amount} falls due on {due}. Please let us know if anything is needed to process it on time.",
}
STRATEGIES = {"by_due": "By due date", "preserve_cash": "Preserve cash", "early_discount": "Capture early-payment discounts"}


def num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def inr(v):
    n = round(num(v))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


def dnum(iso):
    try:
        return datetime.date.fromisoformat(str(iso)[:10]).toordinal()
    except ValueError:
        return None


def iso_from(n):
    return datetime.date.fromordinal(n).isoformat()


def biz_name(sb, bid):
    try:
        row = sb.one("businesses", "name", {"id": eq(bid)})
    except ApiError:
        row = None
    return (row or {}).get("name") or bid


def notify(sb, org, title, body="", kind="info", audience="", link_page="", link_id=""):
    """Record an in-app notification. Never blocks the mutation that triggered it."""
    try:
        sb.insert("notifications", {"id": "ntf_" + uuid.uuid4().hex[:12], "org": org, "audience": audience, "kind": kind,
                                    "title": str(title)[:160], "body": str(body)[:240], "link_page": link_page,
                                    "link_id": link_id, "read_by": "[]", "created_at": now()})
    except Exception as e:  # noqa: BLE001 - optional table before migration 004
        print("InvoiceOS: notification not recorded:", e)


def org_settings(sb, org):
    try:
        return sb.one("org_settings", "*", {"org": eq(org)}) or {}
    except ApiError:
        return {}


def approval_threshold(sb, org):
    v = num(org_settings(sb, org).get("approval_threshold"))
    return Decimal(str(v)) if v > 0 else None


def role_gate(sb, query_or_body, allowed, label):
    """Resolve the demo role (GET query dict or JSON body) and check it may use this feature."""
    def get(k):
        v = query_or_body.get(k)
        return ((v[0] if v else "") or "").strip() if isinstance(v, list) else v
    role = get("role")
    actor = get("actor") or get("org")
    if role not in allowed:
        raise ApiError(403, f"This role does not have access to {label}")
    return calendar_actor(sb, {"role": role, "actor": actor})


def outstanding(inv):
    return max(0.0, num(inv["total"]) - num(inv.get("amount_paid")))


# ---- notifications

def audience_has(row, role):
    aud = (row.get("audience") or "").strip()
    return not aud or role in aud.split(",")


def get_notifications(sb, query):
    role, info, person = role_gate(sb, query, set(ROLES), "notifications")
    rows = sb.select("notifications", "*", {"org": eq(info["org"])}, order="created_at.desc", limit=200)
    items = []
    for r in rows:
        if not audience_has(r, role):
            continue
        try:
            read = role in json.loads(r.get("read_by") or "[]")
        except ValueError:
            read = False
        items.append({k: r.get(k, "") for k in ("id", "kind", "title", "body", "link_page", "link_id", "created_at")} | {"read": read})
    return 200, {"items": items[:40], "unread": sum(1 for i in items if not i["read"])}


def read_notifications(sb, d):
    role, info, person = role_gate(sb, d, set(ROLES), "notifications")
    ids = d.get("ids")
    if ids is not None and (not isinstance(ids, list) or len(ids) > 200 or any(not isinstance(i, str) for i in ids)):
        raise ApiError(400, "ids must be a list of notification ids")
    changed = 0
    for r in sb.select("notifications", "*", {"org": eq(info["org"])}):
        if ids is not None and r["id"] not in ids:
            continue
        if not audience_has(r, role):
            continue
        try:
            seen = json.loads(r.get("read_by") or "[]")
        except ValueError:
            seen = []
        if role not in seen:
            sb.update("notifications", {"id": eq(r["id"])}, {"read_by": json.dumps(sorted(set(seen) | {role}))})
            changed += 1
    return 200, {"ok": True, "marked": changed}


# ---- partner behaviour (shared by cash-flow, collections and scorecards)

def customer_lateness(invoices):
    """Average days paid after the due date per customer, from paid invoices (negative = early)."""
    acc = {}
    for i in invoices:
        if i["status"] == "Paid" and i.get("paid_date"):
            p, due = dnum(i["paid_date"]), dnum(i["due_date"])
            if p is not None and due is not None:
                acc.setdefault(i["customer"], []).append(p - due)
    return {k: sum(v) / len(v) for k, v in acc.items()}


def get_cashflow(sb, query):
    role, info, person = role_gate(sb, query, {"owner", "finance_manager", "auditor"}, "the cash-flow forecast")
    org = info["org"]
    try:
        days = int((query.get("days", ["60"])[0] or "60"))
    except ValueError:
        raise ApiError(400, "days must be 30, 60 or 90")
    if days not in (30, 60, 90):
        raise ApiError(400, "days must be 30, 60 or 90")
    t0 = dnum(today())
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    invoices = sb.select("invoices", "*", {"supplier": eq(org)})
    late = customer_lateness(invoices)
    items, on_hold = [], []
    for i in invoices:
        amt = outstanding(i)
        if amt <= 0:
            continue
        party = names.get(i["customer"], i["customer"])
        if i["status"] == "Dispute":
            on_hold.append({"id": i["id"], "party": party, "amount": amt, "reason": i.get("dispute_reason") or "Open query"})
            continue
        if i["status"] not in OPEN_AR:
            continue
        due = dnum(i["due_date"])
        shift = max(0, round(late.get(i["customer"], 0)))
        promised = dnum(i.get("promised_date")) if i.get("promised_date") else None
        if promised is not None and promised >= t0:
            when, basis = promised, "Promised date"
        elif due + shift >= t0:
            when, basis = due + shift, ("Due date" if not shift else f"Due + {shift}d (customer average)")
        elif t0 - due > 60:
            on_hold.append({"id": i["id"], "party": party, "amount": amt, "reason": f"{t0 - due} days overdue · treated as at risk"})
            continue
        else:
            when, basis = t0, "Past due · expected now"
        items.append({"type": "in", "id": i["id"], "party": party, "party_id": i["customer"], "amount": amt,
                      "date": iso_from(when), "due_date": i["due_date"], "basis": basis, "status": i["status"]})
    for b in sb.select("bills", "*", {"buyer": eq(org)}):
        if b["status"] not in OPEN_AP:
            continue
        due = dnum(b["due_date"])
        sched = dnum(b.get("scheduled_date")) if b.get("scheduled_date") else None
        when = sched if sched is not None else max(due, t0)
        basis = "Scheduled run" if sched is not None else ("Due date" if due >= t0 else "Past due · pay now")
        items.append({"type": "out", "id": b["id"], "party": names.get(b["vendor"], b["vendor"]), "party_id": b["vendor"],
                      "amount": num(b["amount"]), "date": iso_from(when), "due_date": b["due_date"], "basis": basis,
                      "status": b["status"]})
    items = [x for x in items if dnum(x["date"]) < t0 + days]
    items.sort(key=lambda x: (x["date"], x["type"], x["id"]))
    opening = num(org_settings(sb, org).get("opening_balance"))
    weeks, bal = [], opening
    for w in range((days + 6) // 7):
        start, end = t0 + w * 7, min(t0 + w * 7 + 6, t0 + days - 1)
        inflow = sum(x["amount"] for x in items if x["type"] == "in" and start <= dnum(x["date"]) <= end)
        outflow = sum(x["amount"] for x in items if x["type"] == "out" and start <= dnum(x["date"]) <= end)
        bal += inflow - outflow
        weeks.append({"start": iso_from(start), "end": iso_from(end), "inflow": round(inflow, 2),
                      "outflow": round(outflow, 2), "net": round(inflow - outflow, 2), "balance": round(bal, 2)})
    low = min(weeks, key=lambda w: w["balance"]) if weeks else None
    return 200, {"org": org, "days": days, "today": today(), "opening_balance": opening, "weeks": weeks, "items": items,
                 "on_hold": on_hold, "lateness": {names.get(k, k): round(v, 1) for k, v in late.items()},
                 "customers": sorted({(x["party_id"], x["party"]) for x in items if x["type"] == "in"}, key=lambda c: c[1]),
                 "totals": {"inflow": round(sum(x["amount"] for x in items if x["type"] == "in"), 2),
                            "outflow": round(sum(x["amount"] for x in items if x["type"] == "out"), 2),
                            "closing": weeks[-1]["balance"] if weeks else opening,
                            "lowest": low["balance"] if low else opening, "lowest_week": low["start"] if low else today()},
                 "can_edit": not info.get("read_only") and info["authority"]}


def set_opening_balance(sb, d):
    role, info, person = role_gate(sb, d, {"owner", "finance_manager", "approver"}, "cash settings")
    value = decimal_value(d.get("opening_balance"), "Opening balance", maximum=Decimal("10000000000"))
    return 200, upsert_settings(sb, info["org"], {"opening_balance": str(value.quantize(Decimal("0.01")))})


def upsert_settings(sb, org, patch):
    patch = dict(patch, updated_at=now())
    if org_settings(sb, org):
        sb.update("org_settings", {"org": eq(org)}, patch)
    else:
        sb.insert("org_settings", {"org": org, "opening_balance": "0", "approval_threshold": "0", **patch})
    return {"ok": True, **org_settings(sb, org)}


def set_approval_rule(sb, d):
    role, info, person = role_gate(sb, d, {"owner", "finance_manager", "approver"}, "approval rules")
    value = decimal_value(d.get("approval_threshold"), "Approval threshold", maximum=Decimal("1000000000"))
    out = upsert_settings(sb, info["org"], {"approval_threshold": str(value.quantize(Decimal("0.01")))})
    notify(sb, info["org"], "Approval rule updated",
           (f"Bills above {inr(value)} now need the approver" if value > 0 else "Approval threshold switched off")
           + f" · by {person['name']}", "settings", "", "paymentRun", "")
    return 200, out


# ---- collections

def collection_item(inv, names, reminders, late, t0):
    due = dnum(inv["due_date"])
    days_late = t0 - due
    amt = outstanding(inv)
    party = names.get(inv["customer"], inv["customer"])
    rem = sorted([r for r in reminders if r["invoice_id"] == inv["id"]], key=lambda r: r["created_at"], reverse=True)
    if days_late <= 0:
        tone = "upcoming"
    elif days_late > 45 or len(rem) >= 2:
        tone = "final"
    elif days_late > 15 or rem:
        tone = "firm"
    else:
        tone = "gentle"
    fill = dict(name=party, iid=inv["id"], amount=inr(amt), due=inv["due_date"], late=max(days_late, 0))
    promise = None
    if inv.get("promised_date"):
        p = dnum(inv["promised_date"])
        promise = {"date": inv["promised_date"], "days": p - t0, "missed": p < t0}
    return {"id": inv["id"], "customer": inv["customer"], "party": party, "description": inv["description"],
            "status": inv["status"], "issue_date": inv["issue_date"], "due_date": inv["due_date"], "total": num(inv["total"]),
            "outstanding": amt, "days_late": days_late, "score": round(amt * max(days_late, 0)),
            "customer_avg_late": round(late.get(inv["customer"], 0), 1) if inv["customer"] in late else None,
            "suggested_tone": tone, "templates": {k: REMINDER_TEXT[k].format(**fill) for k in REMINDER_TEXT},
            "reminders": [{k: r[k] for k in ("id", "tone", "body", "status", "created_by_staff", "created_at")} for r in rem],
            "promise": promise, "disputed": inv["status"] == "Dispute"}


def get_collections(sb, query):
    role, info, person = role_gate(sb, query, {"owner", "finance_manager", "ar"}, "the collections workbench")
    org = info["org"]
    t0 = dnum(today())
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    invoices = sb.select("invoices", "*", {"supplier": eq(org)})
    reminders = sb.select("reminders", "*", {"org": eq(org)})
    late = customer_lateness(invoices)
    buckets = {"current": 0.0, "0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    counts = {k: 0 for k in buckets}
    items = []
    for i in invoices:
        if i["status"] not in OPEN_AR | {"Dispute"} or outstanding(i) <= 0:
            continue
        dl = t0 - dnum(i["due_date"])
        key = "current" if dl <= 0 else "0-30" if dl <= 30 else "31-60" if dl <= 60 else "61-90" if dl <= 90 else "90+"
        buckets[key] += outstanding(i)
        counts[key] += 1
        if dl > 0 or dl >= -14:
            items.append(collection_item(i, names, reminders, late, t0))
    items.sort(key=lambda x: (-x["score"], x["due_date"]))
    overdue = [x for x in items if x["days_late"] > 0]
    return 200, {"today": today(), "items": items,
                 "aging": [{"bucket": k, "amount": round(v, 2), "count": counts[k]} for k, v in buckets.items()],
                 "totals": {"overdue": round(sum(x["outstanding"] for x in overdue), 2), "overdue_count": len(overdue),
                            "due_soon": round(sum(x["outstanding"] for x in items if x["days_late"] <= 0), 2),
                            "promised": sum(1 for x in items if x["promise"] and not x["promise"]["missed"])},
                 "can_act": not info.get("read_only")}


def collections_invoice(sb, iid, d):
    role, info, person = role_gate(sb, d, {"owner", "finance_manager", "ar"}, "the collections workbench")
    inv = sb.one("invoices", "*", {"id": eq(iid)})
    if not inv or inv["supplier"] != info["org"]:
        raise ApiError(404, "Invoice not found")
    if inv["status"] not in OPEN_AR | {"Dispute"} or outstanding(inv) <= 0:
        raise ApiError(409, "This invoice is not open for collection")
    return role, info, person, inv


def send_reminder(sb, iid, d):
    role, info, person, inv = collections_invoice(sb, iid, d)
    tone = d.get("tone")
    if tone not in TONES + ("upcoming",):
        raise ApiError(400, "Choose a gentle, firm or final tone")
    body_text = clean_text(d.get("body"), "Reminder text", 2000)
    stamp = now()
    rid = "rem_" + uuid.uuid4().hex[:10]
    sb.insert("reminders", {"id": rid, "invoice_id": iid, "org": info["org"], "tone": tone, "body": body_text,
                            "status": "Sent (demo)", "created_by_staff": person["id"], "created_at": stamp})
    sb.insert("activity", {"invoice_id": iid, "actor": info["org"], "action": "Reminder sent (demo)",
                           "detail": f"{tone.title()} reminder by {person['name']} · no email was sent", "created_at": stamp})
    notify(sb, inv["customer"], f"{biz_name(sb, info['org'])} sent a payment reminder",
           f"{iid} · {inr(outstanding(inv))} (demo reminder, nothing was emailed)", "reminder", "", "detail", iid)
    return 201, {"ok": True, "id": rid}


def record_promise(sb, iid, d):
    role, info, person, inv = collections_invoice(sb, iid, d)
    date = iso_date(d.get("promised_date"), "Promise date")
    if date < today():
        raise ApiError(400, "The promise date can't be in the past")
    if dnum(date) > dnum(today()) + 180:
        raise ApiError(400, "Choose a promise date within six months")
    sb.update("invoices", {"id": eq(iid)}, {"promised_date": date, "updated_at": now()})
    sb.insert("activity", {"invoice_id": iid, "actor": info["org"], "action": "Promise to pay recorded",
                           "detail": f"Customer promised payment by {date} · noted by {person['name']}", "created_at": now()})
    return 200, {"ok": True, "promised_date": date}


# ---- payment runs (buyer side)

PAY_ROLES = {"ap", "approver"}


def plan_run(bills, strategy, pay_date):
    p = dnum(pay_date)
    included, deferred = [], []
    for b in sorted(bills, key=lambda b: (b["due_date"], b["id"])):
        due = dnum(b["due_date"])
        disc_ok = num(b.get("discount_pct")) > 0 and b.get("discount_by") and dnum(b["discount_by"]) >= p
        discount = round(num(b["amount"]) * num(b.get("discount_pct")) / 100, 2) if disc_ok else 0.0
        late = p > due
        row = {"id": b["id"], "vendor": b["vendor"], "vendor_invoice_id": b["vendor_invoice_id"], "due_date": b["due_date"],
               "amount": num(b["amount"]), "discount": discount, "pay": round(num(b["amount"]) - discount, 2),
               "discount_pct": num(b.get("discount_pct")), "discount_by": b.get("discount_by") or "", "late": late}
        if strategy == "by_due":
            row["reason"] = "Past due · pay in this run" if late else f"Due {b['due_date']}"
            included.append(row)
        elif strategy == "preserve_cash":
            if due <= p + 7:
                row["reason"] = "Past due" if late else "Due within 7 days of the pay date"
                included.append(row)
            else:
                row["reason"] = f"Not due until {b['due_date']} · keep the cash for now"
                deferred.append(row)
        else:
            if discount:
                row["reason"] = f"Earns {row['discount_pct']:g}% if paid by {b['discount_by']}"
                included.append(row)
            elif due <= p + 7:
                row["reason"] = "Past due" if late else "Due within 7 days of the pay date"
                included.append(row)
            else:
                row["reason"] = "No discount on offer and not due soon"
                deferred.append(row)
    return included, deferred


def run_inputs(sb, d):
    role, info, person = role_gate(sb, d, PAY_ROLES, "payment runs")
    org = info["org"]
    strategy = d.get("strategy")
    if strategy not in STRATEGIES:
        raise ApiError(400, "Choose a payment strategy")
    pay_date = iso_date(d.get("pay_date", today()), "Pay date")
    if pay_date < today() or dnum(pay_date) > dnum(today()) + 90:
        raise ApiError(400, "Choose a pay date between today and 90 days ahead")
    ids = d.get("bill_ids")
    if not isinstance(ids, list) or not ids or len(ids) > 100 or any(not isinstance(i, str) for i in ids):
        raise ApiError(400, "Select at least one approved bill")
    bills = []
    for bid in dict.fromkeys(ids):
        b = sb.one("bills", "*", {"id": eq(bid)})
        if not b or b["buyer"] != org:
            raise ApiError(404, f"Bill {bid} not found")
        if b["status"] != "Approved":
            raise ApiError(409, f"{bid} is {b['status']}; only approved bills can join a payment run")
        bills.append(b)
    return role, info, person, org, strategy, pay_date, bills


def run_summary(sb, org, included, deferred, strategy, pay_date):
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    for r in included + deferred:
        r["vendor_name"] = names.get(r["vendor"], r["vendor"])
    opening = num(org_settings(sb, org).get("opening_balance"))
    committed = sum(num(r["total"]) for r in sb.select("payment_runs", "*", {"buyer": eq(org), "status": eq("Scheduled")}))
    total = round(sum(r["pay"] for r in included), 2)
    return {"strategy": strategy, "strategy_label": STRATEGIES[strategy], "pay_date": pay_date, "included": included,
            "deferred": deferred, "total": total, "gross": round(sum(r["amount"] for r in included), 2),
            "discount": round(sum(r["discount"] for r in included), 2), "deferred_total": round(sum(r["amount"] for r in deferred), 2),
            "cash": {"opening": opening, "committed": round(committed, 2), "available": round(opening - committed, 2),
                     "after": round(opening - committed - total, 2)}}


def preview_run(sb, d):
    role, info, person, org, strategy, pay_date, bills = run_inputs(sb, d)
    inc, dfr = plan_run(bills, strategy, pay_date)
    return 200, run_summary(sb, org, inc, dfr, strategy, pay_date)


def create_run(sb, d):
    role, info, person, org, strategy, pay_date, bills = run_inputs(sb, d)
    inc, dfr = plan_run(bills, strategy, pay_date)
    if not inc:
        raise ApiError(409, "This strategy leaves no bills in the run. Pick another strategy or more bills")
    summary = run_summary(sb, org, inc, dfr, strategy, pay_date)
    existing = {r["id"] for r in sb.select("payment_runs", "id", {"buyer": eq(org)})}
    n = max([int(x[3:]) for x in existing if re.fullmatch(r"PR-\d{1,6}", x)] or [0]) + 1
    while f"PR-{n:04d}" in existing:
        n += 1
    rid = f"PR-{n:04d}"
    if sb.one("payment_runs", "id", {"id": eq(rid)}):
        rid = "PR-" + uuid.uuid4().hex[:6].upper()
    stamp = now()
    sb.insert("payment_runs", {"id": rid, "buyer": org, "strategy": strategy, "status": "Scheduled", "pay_date": pay_date,
                               "total": str(summary["total"]), "discount": str(summary["discount"]), "bill_count": len(inc),
                               "created_by_staff": person["id"], "created_at": stamp, "updated_at": stamp})
    for r in inc:
        patch_bill_status(sb, r["id"], {"status": "Scheduled", "actor": org, "role": role})
        sb.update("bills", {"id": eq(r["id"])}, {"scheduled_date": pay_date, "payment_run_id": rid})
        sb.insert("payment_run_items", {"id": f"pri_{rid}_{r['id']}", "run_id": rid, "bill_id": r["id"],
                                        "amount": str(r["pay"]), "discount": str(r["discount"]), "created_at": stamp})
        sb.insert("bill_activity", {"bill_id": r["id"], "actor": org, "action": "Added to payment run",
                                    "detail": f"{rid} · pays on {pay_date} · {STRATEGIES[strategy]} (demo)", "created_at": stamp})
    other = "approver" if role == "ap" else "ap"
    notify(sb, org, f"Payment run {rid} scheduled", f"{len(inc)} bill{'s' if len(inc) != 1 else ''} · {inr(summary['total'])} · "
           f"pays {pay_date} · by {person['name']} (simulated, no money moves)", "payment_run", other, "paymentRun", rid)
    return 201, {"ok": True, "id": rid, **summary}


def mark_run_paid(sb, rid, d):
    role, info, person = role_gate(sb, d, PAY_ROLES, "payment runs")
    run = sb.one("payment_runs", "*", {"id": eq(rid)})
    if not run or run["buyer"] != info["org"]:
        raise ApiError(404, "Payment run not found")
    if run["status"] != "Scheduled":
        raise ApiError(409, "Only a scheduled run can be marked paid")
    paid = 0
    for item in sb.select("payment_run_items", "*", {"run_id": eq(rid)}):
        b = sb.one("bills", "status", {"id": eq(item["bill_id"])})
        if b and b["status"] == "Scheduled":
            patch_bill_status(sb, item["bill_id"], {"status": "Paid", "actor": run["buyer"], "role": role})
            paid += 1
    rows = sb.update("payment_runs", {"id": eq(rid), "status": eq("Scheduled")}, {"status": "Paid", "updated_at": now()})
    if not rows:
        raise ApiError(409, "This run changed. Refresh and try again")
    notify(sb, run["buyer"], f"Payment run {rid} marked paid", f"{paid} bill{'s' if paid != 1 else ''} · {inr(run['total'])} · "
           f"by {person['name']} (demo, no money moved)", "payment_run", "approver" if role == "ap" else "ap", "paymentRun", rid)
    return 200, {"ok": True, "paid": paid}


# ---- partner scorecards

def scorecard(paid_rows, all_rows, open_amount, start_key, disputed):
    days = [dnum(r["paid_date"]) - dnum(r[start_key]) for r in paid_rows]
    late = [dnum(r["paid_date"]) - dnum(r["due_date"]) for r in paid_rows]
    return {"documents": len(all_rows), "paid": len(paid_rows),
            "avg_days_to_pay": round(sum(days) / len(days), 1) if days else None,
            "avg_days_late": round(sum(late) / len(late), 1) if late else None,
            "on_time_pct": round(100 * sum(1 for x in late if x <= 0) / len(late)) if late else None,
            "dispute_rate": round(100 * disputed / len(all_rows)) if all_rows else None,
            "disputed": disputed, "open_balance": round(open_amount, 2)}


def get_partners(sb, query):
    role, info, person = role_gate(sb, query, set(ROLES), "partner scorecards")
    org = info["org"]
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    partners = set()
    for c in sb.select("connections", "*", {"or": f"(requester.eq.{pgq(org)},target.eq.{pgq(org)})", "status": eq("Connected")}):
        partners.add(c["target"] if c["requester"] == org else c["requester"])
    invoices = sb.select("invoices", "*", {"or": f"(supplier.eq.{pgq(org)},customer.eq.{pgq(org)})"})
    bills = sb.select("bills", "*", {"buyer": eq(org)})
    disputed_ids = {a["invoice_id"] for a in sb.select("activity", "invoice_id,action", {"action": eq("Dispute")})}
    out = []
    for p in sorted(partners, key=lambda x: names.get(x, x)):
        recv = [i for i in invoices if i["supplier"] == org and i["customer"] == p and i["status"] != "Draft"]
        pay_inv = [i for i in invoices if i["customer"] == org and i["supplier"] == p and i["status"] != "Draft"]
        pay_bills = [b for b in bills if b["vendor"] == p and b["status"] != "Rejected"]
        dis = lambda rows: sum(1 for i in rows if i["status"] == "Dispute" or i.get("dispute_reason") or i["id"] in disputed_ids)
        entry = {"id": p, "name": names.get(p, p), "they_pay_you": None, "you_pay_them": None}
        if recv:
            paid = [i for i in recv if i["status"] == "Paid" and i.get("paid_date")]
            open_amt = sum(outstanding(i) for i in recv if i["status"] in OPEN_AR | {"Dispute"})
            entry["they_pay_you"] = scorecard(paid, recv, open_amt, "issue_date", dis(recv))
        if pay_bills or pay_inv:
            paid = [b for b in pay_bills if b["status"] == "Paid" and b.get("paid_date")]
            open_amt = sum(num(b["amount"]) for b in pay_bills if b["status"] in OPEN_AP)
            card = scorecard(paid, pay_bills or pay_inv, open_amt, "received_date", dis(pay_inv))
            card["dispute_rate"] = round(100 * dis(pay_inv) / len(pay_inv)) if pay_inv else None
            entry["you_pay_them"] = card
        out.append(entry)
    return 200, {"org": org, "partners": out, "today": today()}


# ---- audit pack

def get_audit_pack(sb, query):
    role, info, person = role_gate(sb, query, {"auditor", "owner", "finance_manager"}, "the audit pack")
    org = info["org"]
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    invoices = {i["id"]: i for i in sb.select("invoices", "*", {"or": f"(supplier.eq.{pgq(org)},customer.eq.{pgq(org)})"})}
    bills = {b["id"]: b for b in sb.select("bills", "*", {"or": f"(buyer.eq.{pgq(org)},vendor.eq.{pgq(org)})"})}
    rows = []
    for a in sb.select("activity", "*", order="created_at.asc"):
        i = invoices.get(a["invoice_id"])
        if i:
            other = i["customer"] if i["supplier"] == org else i["supplier"]
            rows.append([a["created_at"], "invoice", i["id"], names.get(a["actor"], a["actor"]), a["action"], a["detail"],
                         names.get(other, other), f"{num(i['total']):.2f}", i["status"]])
    for a in sb.select("bill_activity", "*", order="created_at.asc"):
        b = bills.get(a["bill_id"])
        if b:
            other = b["vendor"] if b["buyer"] == org else b["buyer"]
            rows.append([a["created_at"], "bill", b["id"], names.get(a["actor"], a["actor"]), a["action"], a["detail"],
                         names.get(other, other), f"{num(b['amount']):.2f}", b["status"]])
    for r in sb.select("payment_runs", "*", {"buyer": eq(org)}):
        rows.append([r["created_at"], "payment_run", r["id"], names.get(org, org), f"Run {r['status'].lower()}",
                     f"{r['bill_count']} bills · {STRATEGIES.get(r['strategy'], r['strategy'])} · pay {r['pay_date']} (demo)",
                     "", f"{num(r['total']):.2f}", r["status"]])
    rows.sort(key=lambda r: r[0])

    def cell(v):
        s = str(v if v is not None else "")
        if s[:1] in ("=", "+", "-", "@"):
            s = "'" + s  # keep spreadsheet apps from evaluating cells
        return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\n') else s
    header = ["timestamp", "record_type", "record_id", "actor", "action", "detail", "counterparty", "amount_inr", "current_status"]
    csv_text = "\n".join(",".join(cell(c) for c in r) for r in [header] + rows) + "\n"
    return 200, {"filename": f"invoiceos-audit-pack-{org}-{today()}.csv", "rows": len(rows), "csv": csv_text,
                 "generated_by": person["name"], "note": "Demo data only. Generated from recorded activity rows."}


# --- GST ---
# Read-only GST workspace preview. Computed from invoices (output tax) and bills (input tax credit).
# Nothing is filed or submitted anywhere.
GST_MONTH_RE = re.compile(r"\d{4}-(0[1-9]|1[0-2])")
GST_RATES = (0, 5, 12, 18, 28)
GST_DEFAULT_RATE = Decimal("18")
GST_SKIP = {"Draft", "Rejected"}
GST_ROLES = {"owner", "finance_manager", "ar", "ap", "auditor"}
P2 = Decimal("0.01")


def _d(v):
    try:
        return Decimal(str(v if v not in (None, "") else 0))
    except InvalidOperation:
        return Decimal(0)


def _q(v):
    return v.quantize(P2, rounding=ROUND_HALF_UP)


def gst_months(count=6):
    t = datetime.date.today()
    y, m = t.year, t.month
    out = []
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def _gst_split(tax, supplier_gstin, buyer_gstin):
    """Return (cgst, sgst, igst). Same two-digit state code -> CGST+SGST split equally, else IGST."""
    a, b = (supplier_gstin or "")[:2], (buyer_gstin or "")[:2]
    if a.isdigit() and a == b:
        c = _q(tax / 2)
        return c, tax - c, Decimal(0)
    return Decimal(0), Decimal(0), tax


def get_gst(sb, query):
    role, info, person = role_gate(sb, query, GST_ROLES, "the GST workspace")
    org = info["org"]
    raw = (query.get("month", [""])[0] or "").strip()
    months = gst_months()
    month = raw or months[0]
    if not GST_MONTH_RE.fullmatch(month):
        raise ApiError(400, "month must look like 2026-11")
    biz_rows = sb.select("businesses", "id,name,gstin")
    names = {b["id"]: b["name"] for b in biz_rows}
    gstins = {b["id"]: b.get("gstin") or "" for b in biz_rows}
    inv_out = [i for i in sb.select("invoices", "*", {"supplier": eq(org)})]
    inv_in = {i["id"].lower(): i for i in sb.select("invoices", "*", {"customer": eq(org)})}
    zero = lambda: {"cgst": Decimal(0), "sgst": Decimal(0), "igst": Decimal(0), "taxable": Decimal(0)}
    out_t, in_t = zero(), zero()
    rates = {r: {"rate": r, "out_taxable": Decimal(0), "out_tax": Decimal(0), "in_taxable": Decimal(0), "in_tax": Decimal(0)}
             for r in GST_RATES}
    out_rows, drafts, disputes, missing_gstin = [], [], [], []

    def add_rate(rate, side, taxable, tax):
        r = rates.get(int(rate)) if rate == rate.to_integral_value() else None
        if r is None:
            r = rates.setdefault(int(rate), {"rate": int(rate), "out_taxable": Decimal(0), "out_tax": Decimal(0),
                                             "in_taxable": Decimal(0), "in_tax": Decimal(0)})
        r[side + "_taxable"] += taxable
        r[side + "_tax"] += tax

    for i in sorted(inv_out, key=lambda x: x["id"]):
        if str(i["issue_date"])[:7] != month:
            continue
        if i["status"] == "Draft":
            drafts.append(i["id"])
        if i["status"] in GST_SKIP:
            continue
        rate = _d(i["tax"])
        taxable = _q(_d(i["qty"]) * _d(i["rate"]))
        tax = _q(taxable * rate / 100)
        sg, cg = (i.get("supplier_gstin") or "").strip(), (i.get("customer_gstin") or "").strip()
        if not sg or not cg:
            missing_gstin.append(i["id"])
        c, s, g = _gst_split(tax, sg, cg)
        for k, v in (("cgst", c), ("sgst", s), ("igst", g), ("taxable", taxable)):
            out_t[k] += v
        add_rate(rate, "out", taxable, tax)
        if i["status"] == "Dispute":
            disputes.append(i["id"])
        out_rows.append({"id": i["id"], "party": names.get(i["customer"], i["customer"]), "date": str(i["issue_date"])[:10],
                         "status": i["status"], "rate": float(rate), "taxable": float(taxable), "cgst": float(c),
                         "sgst": float(s), "igst": float(g), "tax": float(tax), "gstin_ok": bool(sg and cg)})
    itc_rows, linked_rate_n = [], 0
    for b in sorted(sb.select("bills", "*", {"buyer": eq(org)}), key=lambda x: x["id"]):
        if str(b["received_date"])[:7] != month or b["status"] in GST_SKIP:
            continue
        amount = _q(_d(b["amount"]))
        inv = inv_in.get(str(b["vendor_invoice_id"]).lower())
        if inv is not None and inv["supplier"] != b["vendor"]:
            inv = None
        sup_g = ((inv or {}).get("supplier_gstin") or gstins.get(b["vendor"], "")).strip()
        buy_g = ((inv or {}).get("customer_gstin") or gstins.get(org, "")).strip()
        rate, basis = GST_DEFAULT_RATE, "assumed"
        if inv is not None and inv["status"] not in GST_SKIP:
            rate, basis = _d(inv["tax"]), "invoice"
            linked_rate_n += 1
        taxable = _q(amount / (1 + rate / 100))
        tax = amount - taxable
        c, s, g = _gst_split(tax, sup_g, buy_g)
        reasons = []
        if inv is None:
            reasons.append("Supplier invoice not found")
        elif inv["status"] in GST_SKIP:
            reasons.append(f"Supplier invoice is {inv['status'].lower()}, not yet Sent")
        elif abs(_d(inv["total"]) - amount) > P2:
            reasons.append(f"Amount differs: bill {inr(amount)} vs invoice {inr(inv['total'])}")
        if not sup_g or not buy_g:
            reasons.append("GSTIN missing")
        if inv is not None and inv["status"] == "Dispute":
            disputes.append(inv["id"])
        for k, v in (("cgst", c), ("sgst", s), ("igst", g), ("taxable", taxable)):
            in_t[k] += v
        add_rate(rate, "in", taxable, tax)
        itc_rows.append({"id": b["id"], "vendor": names.get(b["vendor"], b["vendor"]), "ref": b["vendor_invoice_id"],
                         "invoice_id": inv["id"] if inv else "", "bill_amount": float(amount),
                         "invoice_amount": float(_q(_d(inv["total"]))) if inv else None, "rate": float(rate),
                         "rate_basis": basis, "taxable": float(taxable), "tax": float(tax), "status": b["status"],
                         "match": "ok" if not reasons else "flag", "reasons": reasons})
    out_tax = out_t["cgst"] + out_t["sgst"] + out_t["igst"]
    in_tax = in_t["cgst"] + in_t["sgst"] + in_t["igst"]
    net = out_tax - in_tax
    flagged = [r for r in itc_rows if r["match"] == "flag"]
    at_risk = sum((_d(r["tax"]) for r in flagged), Decimal(0))
    pack = lambda t: {"cgst": float(t["cgst"]), "sgst": float(t["sgst"]), "igst": float(t["igst"]),
                      "taxable": float(t["taxable"]), "tax": float(t["cgst"] + t["sgst"] + t["igst"])}

    def check(key, label, bad, ok_text, warn_text):
        return {"key": key, "label": label, "state": "warn" if bad else "pass", "detail": warn_text if bad else ok_text}
    checklist = [
        check("gstin", "All invoices have GSTINs", missing_gstin, "Every invoice this month has both GSTINs.",
              f"{len(missing_gstin)} invoice(s) missing a GSTIN: " + ", ".join(missing_gstin[:4])),
        check("itc", "No unmatched input tax credit", flagged, "Every bill matches a Sent supplier invoice.",
              f"{len(flagged)} bill(s) flagged, {inr(at_risk)} of ITC at risk."),
        check("disputes", "No disputes pending", disputes, "No disputed invoices this month.",
              f"{len(set(disputes))} disputed invoice(s): " + ", ".join(sorted(set(disputes))[:4])),
        check("drafts", "No Draft invoices in the month", drafts, "No Draft invoices in this month.",
              f"{len(drafts)} Draft invoice(s) excluded from output tax: " + ", ".join(drafts[:4])),
        check("activity", "Month has recorded activity", not (out_rows or itc_rows), "Invoices or bills found for this month.",
              "No invoices or bills dated in this month."),
    ]
    return 200, {
        "org": org, "org_name": names.get(org, org), "month": month, "months": months, "today": today(),
        "read_only": bool(info.get("read_only")),
        "summary": {"output_tax": float(out_tax), "itc": float(in_tax), "net": float(abs(net)),
                    "net_state": "payable" if net > 0 else ("credit" if net < 0 else "nil"),
                    "itc_at_risk": float(at_risk), "output_count": len(out_rows), "input_count": len(itc_rows)},
        "split": {"output": pack(out_t), "input": pack(in_t)},
        "rates": [{k: (float(v) if isinstance(v, Decimal) else v) for k, v in rates[r].items()} for r in sorted(rates)],
        "output_invoices": out_rows, "itc": itc_rows, "checklist": checklist,
        "ready": all(c["state"] == "pass" for c in checklist),
        "notes": ["Preview, no filing: nothing is submitted to the GST portal.",
                  "Bills carry only a total. Taxable value and tax assume 18% unless a Sent supplier invoice gives the real rate "
                  f"({linked_rate_n} of {len(itc_rows)} bills this month use a linked invoice rate).",
                  "Same-state GSTINs (first two digits) split CGST and SGST equally; different states are IGST.",
                  "HSN/SAC codes are not held in this demo data, so no HSN summary is shown."],
    }
# --- END GST ---


# --------------------------------------------------------------------------- dispatch

# --- RECONCILIATION ---------------------------------------------------------------------------------
# Demo bank reconciliation. Statement lines come from the browser (pasted/sample CSV); nothing connects to a bank.
# Confirming a match goes through patch_invoice_status / patch_bill_status so transition tables, optimistic
# guards, activity logging, linked invoice<->bill sync and BUYER_ONLY rules all still apply.
RECON_VIEW_ROLES = {"owner", "finance_manager", "ar", "ap", "approver", "auditor"}
RECON_WRITE_ROLES = RECON_VIEW_ROLES - {"auditor"}
RECON_MAX_LINES = 200
RECON_AR = {"Sent", "Viewed", "Approved", "Overdue", "Partially paid"}
RECON_AP = {"Approved", "Scheduled"}
RECON_SHORT_PCT = Decimal("0.02")  # a credit up to 2% under the due amount may be bank charges


def _rnorm(text):
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _recon_line(raw, i):
    if not isinstance(raw, dict):
        raise ApiError(400, f"Statement line {i + 1} is not valid")
    date = iso_date(raw.get("date"), f"Line {i + 1} date")
    desc = clean_text(raw.get("description", ""), f"Line {i + 1} description", 200, required=False)
    cr = decimal_value(raw.get("credit") or 0, f"Line {i + 1} credit", maximum=Decimal("1000000000"))
    dr = decimal_value(raw.get("debit") or 0, f"Line {i + 1} debit", maximum=Decimal("1000000000"))
    if (cr > 0) == (dr > 0):
        raise ApiError(400, f"Line {i + 1} needs either a debit or a credit amount")
    direction = "credit" if cr > 0 else "debit"
    amount = (cr or dr).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount <= 0:
        raise ApiError(400, f"Line {i + 1} amount must be greater than zero")
    return {"idx": i, "date": date, "description": desc, "direction": direction, "amount": amount}


def _recon_actor(sb, d, allowed, label):
    org = org_id(d.get("org") if isinstance(d, dict) else None, "Organisation")
    role, info, person = role_gate(sb, {"role": d.get("role"), "actor": d.get("actor")}, allowed, label)
    if info["org"] != org:
        raise ApiError(403, "This role does not belong to that business")
    return org, role, person


def _recon_candidates(sb, org):
    names = {}

    def nm(i):
        if i not in names:
            names[i] = biz_name(sb, i)
        return names[i]

    out = []
    for r in sb.select("invoices", "*", {"supplier": eq(org)}):
        if r["status"] not in RECON_AR:
            continue
        due = Decimal(str(r["total"])) - Decimal(str(r.get("amount_paid") or 0))
        if due <= 0:
            continue
        scopes = connection_scopes(sb, r["supplier"], r["customer"])
        block = ""
        if "Paid" not in INVOICE_TRANSITIONS.get(r["status"], set()):
            block = f"{r['id']} is {r['status']}. The buyer has to approve it before it can be marked Paid."
        elif "exchange_invoices" not in scopes or "share_payment_status" not in scopes:
            block = "Payment status sharing is not enabled for this connection."
        out.append({"type": "invoice", "id": r["id"], "direction": "credit", "due": due.quantize(Decimal("0.01")),
                    "total": Decimal(str(r["total"])), "refs": [r["id"], r.get("po_number") or ""],
                    "party": nm(r["customer"]), "due_date": r["due_date"], "status": r["status"], "block": block})
    for r in sb.select("bills", "*", {"buyer": eq(org)}):
        if r["status"] not in RECON_AP:
            continue
        out.append({"type": "bill", "id": r["id"], "direction": "debit", "due": Decimal(str(r["amount"])).quantize(Decimal("0.01")),
                    "total": Decimal(str(r["amount"])), "refs": [r["vendor_invoice_id"], r["id"], r.get("po_number") or ""],
                    "party": nm(r["vendor"]), "due_date": r["due_date"], "status": r["status"],
                    "block": "" if "Paid" in BILL_TRANSITIONS.get(r["status"], set()) else f"{r['id']} is {r['status']}."})
    return out


def _recon_score(line, cand):
    """Return (score, ref_hit, reasons) for one statement line against one open invoice/bill, or None."""
    if line["direction"] != cand["direction"]:
        return None
    score, reasons, ref_hit = 0, [], False
    diff = cand["due"] - line["amount"]
    exact = diff == 0 or line["amount"] == cand["total"]
    short = (not exact) and 0 < diff <= max(cand["due"] * RECON_SHORT_PCT, Decimal("0")) and line["direction"] == "credit"
    if exact:
        score += 50
        reasons.append("Amount equal")
    elif short:
        score += 30
        reasons.append(f"Amount {inr(diff)} short of {inr(cand['due'])} (possible bank charges)")
    ndesc = _rnorm(line["description"])
    for ref in cand["refs"]:
        nref = _rnorm(ref)
        if len(nref) >= 4 and nref in ndesc:
            score += 40
            ref_hit = True
            reasons.append(f"reference {ref} found")
            break
    if not ref_hit:
        for ref in cand["refs"]:
            groups = re.findall(r"\d{3,}", str(ref))
            if groups and groups[-1] in ndesc and len(groups[-1]) >= 3:
                score += 35
                ref_hit = True
                reasons.append(f"partial reference …{groups[-1]} found")
                break
    word = next((w for w in re.findall(r"[a-z]{4,}", cand["party"].lower()) if w not in {"private", "limited", "retail", "studio"}), "")
    if word and word in line["description"].lower():
        score += 10
        reasons.append(f"{cand['party']} named")
    try:
        gap = abs((datetime.date.fromisoformat(line["date"]) - datetime.date.fromisoformat(cand["due_date"])).days)
        if gap <= 10:
            score += 10
            reasons.append("near due date")
    except ValueError:
        pass
    if not (exact or short) or (short and not ref_hit):
        return None
    return score, ref_hit, reasons, exact


def _recon_level(score, exact):
    if score >= 80 and exact:
        return "High"
    if score >= 50:
        return "Medium"
    return "Low"


def reconcile_suggest(sb, d):
    org, role, person = _recon_actor(sb, d, RECON_VIEW_ROLES, "bank reconciliation")
    raw = d.get("lines")
    if not isinstance(raw, list) or not raw:
        raise ApiError(400, "Add at least one statement line")
    if len(raw) > RECON_MAX_LINES:
        raise ApiError(400, f"A statement can have up to {RECON_MAX_LINES} lines in the demo")
    lines = [_recon_line(r, i) for i, r in enumerate(raw)]
    cands = _recon_candidates(sb, org)
    try:
        done = sb.select("bank_reconciliations", "*", {"org": eq(org), "status": eq("Matched")})
    except ApiError:
        done = []  # table arrives with migration 005
    done_keys = {(r["line_date"], str(_rnorm(r["line_desc"])), Decimal(str(r["amount"])).quantize(Decimal("0.01")), r["direction"]): r for r in done}
    seen, flags = {}, {}
    for ln in lines:
        key = (ln["date"], _rnorm(ln["description"]), ln["amount"], ln["direction"])
        if key in done_keys:
            r = done_keys[key]
            flags[ln["idx"]] = ("Reconciled", f"Already reconciled with {r['matched_id']}")
        elif key in seen:
            flags[ln["idx"]] = ("Duplicate", f"Duplicate of line {seen[key] + 1}; not matched twice")
        else:
            seen[key] = ln["idx"]
    pairs = []
    for ln in lines:
        if ln["idx"] in flags:
            continue
        scored = []
        for c in cands:
            sc = _recon_score(ln, c)
            if sc:
                scored.append((sc, c))
        for sc, c in scored:
            score, ref_hit, reasons, exact = sc
            if exact and not ref_hit and sum(1 for o, _ in scored if o[3] and not o[1]) > 1:
                score = min(score, 35)
                reasons = reasons + ["several open items share this amount"]
            pairs.append((score, ln["idx"], c, ref_hit, reasons, exact))
    pairs.sort(key=lambda p: (-p[0], p[1], p[2]["id"]))
    used_l, used_c, picked = set(), set(), {}
    for score, i, c, ref_hit, reasons, exact in pairs:
        if i in used_l or c["id"] in used_c or score < 30:
            continue
        used_l.add(i)
        used_c.add(c["id"])
        picked[i] = (score, c, reasons, exact)
    out = []
    for ln in lines:
        row = {"idx": ln["idx"], "date": ln["date"], "description": ln["description"], "direction": ln["direction"],
               "amount": float(ln["amount"]), "state": "Unmatched", "note": "No open invoice or bill matches this line", "suggestion": None}
        if ln["idx"] in flags:
            row["state"], row["note"] = flags[ln["idx"]]
        elif ln["idx"] in picked:
            score, c, reasons, exact = picked[ln["idx"]]
            level = _recon_level(score, exact)
            row.update(state="Suggested", note="")
            row["suggestion"] = {
                "type": c["type"], "id": c["id"], "party": c["party"], "status": c["status"], "due_date": c["due_date"],
                "due_amount": float(c["due"]), "diff": float(c["due"] - ln["amount"]), "score": score, "confidence": level,
                "reason": " + ".join(reasons), "confirmable": not c["block"], "block_reason": c["block"],
            }
        out.append(row)
    sug = [r for r in out if r["suggestion"]]
    summary = {"lines": len(out), "suggested": len(sug), "high": sum(1 for r in sug if r["suggestion"]["confidence"] == "High" and r["suggestion"]["confirmable"]),
               "duplicates": sum(1 for r in out if r["state"] == "Duplicate"),
               "unmatched": sum(1 for r in out if r["state"] == "Unmatched"),
               "credits": float(sum(Decimal(str(r["amount"])) for r in out if r["direction"] == "credit")),
               "debits": float(sum(Decimal(str(r["amount"])) for r in out if r["direction"] == "debit"))}
    return 200, {"org": org, "demo": True, "simulated": "Demo statement. No real bank connection.", "lines": out, "summary": summary}


def reconcile_confirm(sb, d):
    org, role, person = _recon_actor(sb, d, RECON_WRITE_ROLES, "confirming reconciliations")
    line = _recon_line(d.get("line") if isinstance(d.get("line"), dict) else {}, 0)
    mtype = d.get("match_type")
    if mtype not in ("invoice", "bill"):
        raise ApiError(400, "match_type must be invoice or bill")
    mid = clean_text(d.get("match_id"), "Match id", 40)
    if not INVOICE_ID_RE.fullmatch(mid):
        raise ApiError(400, "Match id is not valid")
    if (mtype == "invoice") != (line["direction"] == "credit"):
        raise ApiError(400, "Credits match invoices and debits match bills")
    cand = next((c for c in _recon_candidates(sb, org) if c["type"] == mtype and c["id"] == mid), None)
    if not cand:
        table = "invoices" if mtype == "invoice" else "bills"
        row = sb.one(table, "id,status", {"id": eq(mid)})
        if not row:
            raise ApiError(404, f"{mtype.capitalize()} not found")
        if row["status"] == "Paid":
            raise ApiError(409, f"{mid} is already Paid")
        raise ApiError(409, f"{mid} is not open for reconciliation ({row['status']}) in this business")
    if cand["block"]:
        raise ApiError(409, cand["block"])
    diff = cand["due"] - line["amount"]
    if not (diff == 0 or line["amount"] == cand["total"] or (line["direction"] == "credit" and 0 < diff <= cand["due"] * RECON_SHORT_PCT)):
        raise ApiError(400, "The bank amount does not match this item")
    try:
        if sb.one("bank_reconciliations", "id", {"org": eq(org), "matched_type": eq(mtype), "matched_id": eq(mid), "status": eq("Matched")}):
            raise ApiError(409, f"{mid} is already reconciled")
    except ApiError as e:
        if e.status == 409 and "already reconciled" in e.message:
            raise
    handler = patch_invoice_status if mtype == "invoice" else patch_bill_status
    handler(sb, mid, {"status": "Paid", "actor": org, "role": role})
    detail = f"Reconciled with bank line {line['date']} · {line['description'][:90] or 'no description'} · {inr(line['amount'])} (demo statement)"
    stamp = now()
    if mtype == "invoice":
        sb.insert("activity", {"invoice_id": mid, "actor": org, "action": "Reconciled", "detail": detail, "created_at": stamp})
    else:
        sb.insert("bill_activity", {"bill_id": mid, "actor": org, "action": "Reconciled", "detail": detail, "created_at": stamp})
    rid = "rec_" + uuid.uuid4().hex[:12]
    try:
        sb.insert("bank_reconciliations", {"id": rid, "org": org, "line_date": line["date"], "line_desc": line["description"],
                                           "amount": str(line["amount"]), "direction": line["direction"], "matched_type": mtype,
                                           "matched_id": mid, "status": "Matched", "created_by": person["name"], "created_at": stamp})
    except ApiError as e:  # optional until migration 005
        print("InvoiceOS: reconciliation record not stored:", e.message)
    return 200, {"ok": True, "id": rid, "matched_type": mtype, "matched_id": mid, "status": "Paid"}


def get_reconciliations(sb, query):
    org = org_id((query.get("org") or [""])[0], "Organisation")
    role = ((query.get("role") or [""])[0] or "").strip()
    _, _, _ = _recon_actor(sb, {"org": org, "role": role, "actor": org}, RECON_VIEW_ROLES, "bank reconciliation")
    try:
        rows = sb.select("bank_reconciliations", "*", {"org": eq(org)}, order="created_at.desc", limit=50)
    except ApiError:
        rows = []
    return 200, {"org": org, "items": rows}


# --- END RECONCILIATION -----------------------------------------------------------------------------




# --- ASSISTANT ---------------------------------------------------------------------------------------
# Demo assistant: a deterministic keyword/rule engine (English, Hindi, Hinglish). NO language model, NO external call.
# `assistant_ask` answers read-only questions from this org's invoices/bills, or STAGES a change as an `ai_action` row
# (status Proposed). `assistant_confirm` re-validates, checks the role and then runs the EXISTING handlers
# (create_invoice, patch_invoice_status, patch_bill_status, create_event, send_reminder), so transition tables,
# optimistic guards, approval rules and GST/numbering rules are not bypassed.

AI_ACTIVITY_ROLES = {"owner", "finance_manager", "auditor"}
AI_KIND_ROLES = {  # who may confirm each kind of staged change
    "invoice_paid": ("owner", "finance_manager", "ar"),
    "bill_approve": ("owner", "finance_manager", "approver"),
    "remind_overdue": ("owner", "finance_manager", "ar"),
    "schedule_meeting": ("owner", "finance_manager", "approver"),
    "raise_invoice": ("owner", "finance_manager", "ar"),
}
AI_ROLE_LABEL = {"owner": "Owner", "finance_manager": "Finance Manager", "ar": "AR Accountant", "ap": "AP Accountant",
                 "approver": "Approver", "auditor": "Auditor"}
AI_EXAMPLES = {
    "ar": ["Top 5 customers by sales", "What is overdue?", "Who owes me the most?", "Cash position",
           "Remind overdue customers", "Mark INV-2025-0832 as paid", "इस महीने कितनी बिक्री हुई?"],
    "ap": ["Bills needing approval", "Which bills are due this week?", "What is overdue?", "Cash position",
           "Approve BILL-4521", "Schedule a meeting with Northstar tomorrow 3pm"],
}
AI_NUMW = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
AI_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
AI_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
AI_INV_RE = re.compile(r"\binv-[a-z0-9][a-z0-9._-]*", re.I)
AI_BILL_RE = re.compile(r"\bbill-[a-z0-9][a-z0-9._-]*", re.I)


def _adec(v):
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def _ainr(v):
    """Rupees with Indian digit grouping, from a Decimal (paise shown only when non-zero)."""
    v = _adec(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole, frac = divmod(abs(v), 1)
    s = str(int(whole))
    if len(s) > 3:
        head, tail, parts = s[:-3], s[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if v < 0 else "") + "₹" + s + (f".{int(frac * 100):02d}" if frac else "")


def _aout(inv):
    return max(Decimal(0), _adec(inv["total"]) - _adec(inv.get("amount_paid")))


def _a_actor(sb, d):
    org = org_id(d.get("org"), "Business")
    return calendar_actor(sb, d, org)  # 403 unless the role belongs to that business


def _a_table(columns, rows, num=()):
    return {"columns": columns, "rows": rows, "num": list(num)}


def _a_reply(intent, text, table=None, suggestions=None, actions=None, staged=False):
    return 200, {"intent": intent, "answer_text": text, "table": table, "actions": actions or [], "staged": staged,
                 "suggestions": suggestions or [], "engine": "Demo assistant · rule-based, no external AI"}


def _a_find(sb, table, raw):
    for key in (raw, raw.upper()):
        row = sb.one(table, "*", {"id": eq(key)})
        if row:
            return row
    return None


def _a_party(sb, org, text):
    """Find a connected business named in the text (id or first word of its name)."""
    best = None
    for b in sb.select("businesses", "id,name"):
        if b["id"] == org:
            continue
        words = [b["id"].lower(), b["name"].lower().split()[0]]
        if any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", text) for w in words if len(w) > 2):
            best = best or b
    return best


def _a_amount(text):
    m = re.search(r"(?:₹|rs\.?|inr|for|का|ka)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lakhs|lac|l|cr|crore)?\b", text)
    if not m:
        m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(k|lakh|lakhs|lac|cr|crore)?\b", text)
    if not m:
        return None, text
    n = _adec(m.group(1).replace(",", ""))
    n *= {"k": 1000, "lakh": 100000, "lakhs": 100000, "lac": 100000, "l": 100000, "cr": 10000000, "crore": 10000000}.get(m.group(2) or "", 1)
    return n, (text[:m.start()] + " " + text[m.end():])


def _a_date(text):
    t0 = datetime.date.today()
    if re.search(r"day after tomorrow|parso|परसों|परसो", text):
        return t0 + datetime.timedelta(days=2)
    if re.search(r"tomorrow|\bkal\b|कल", text):
        return t0 + datetime.timedelta(days=1)
    if re.search(r"\btoday\b|\baaj\b|आज", text):
        return t0
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", text)
    if m:
        try:
            d = datetime.date(t0.year, AI_MONTHS.index(m.group(2)) + 1, int(m.group(1)))
            return d if d >= t0 else d.replace(year=t0.year + 1)
        except ValueError:
            return None
    for i, name in enumerate(AI_DAYS):
        if name in text:
            return t0 + datetime.timedelta(days=(i - t0.weekday()) % 7 or 7)
    return None


def _a_time(text):
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if h > 12 or mi > 59 or h == 0:
            return None
        h = h % 12 + (12 if m.group(3) == "pm" else 0)
        return f"{h:02d}:{mi:02d}"
    m = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    m = re.search(r"\b(\d{1,2})\s*(?:baje|बजे)", text)
    if m and 1 <= int(m.group(1)) <= 12:
        h = int(m.group(1))
        pm = h < 8 or h == 12 or bool(re.search(r"shaam|शाम|dopahar|दोपहर|raat|रात", text))
        if re.search(r"subah|सुबह", text):
            pm = False
        return f"{(h % 12) + (12 if pm else 0):02d}:00"
    return None


def _a_ar_rows(sb, org):
    return [i for i in sb.select("invoices", "*", {"supplier": eq(org)}) if i["status"] not in ("Draft", "Rejected")]


def _a_open_ar(sb, org):
    return [i for i in _a_ar_rows(sb, org) if i["status"] in OPEN_AR | {"Dispute"} and _aout(i) > 0]


def _a_open_ap(sb, org):
    return [b for b in sb.select("bills", "*", {"buyer": eq(org)}) if b["status"] in OPEN_AP]


def _a_late(due):
    n = dnum(due)
    return max(0, dnum(today()) - n) if n else 0


# ---- read-only intents
def _a_top(sb, org, role, text, vendors):
    m = re.search(r"\b(?:top|best|biggest|largest|शीर्ष)\s*(\d{1,2}|" + "|".join(AI_NUMW) + r")\b", text) or re.search(r"\b(\d{1,2})\b", text)
    n = 5
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else AI_NUMW[m.group(1)]
    n = max(1, min(n, 10))
    totals = {}
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    if vendors:
        for b in sb.select("bills", "*", {"buyer": eq(org)}):
            if b["status"] != "Rejected":
                t = totals.setdefault(b["vendor"], [Decimal(0), 0])
                t[0] += _adec(b["amount"])
                t[1] += 1
        label, intent = "vendors by spend", "top_vendors"
    else:
        for i in _a_ar_rows(sb, org):
            t = totals.setdefault(i["customer"], [Decimal(0), 0])
            t[0] += _adec(i["total"])
            t[1] += 1
        label, intent = "customers by sales", "top_customers"
    ranked = sorted(totals.items(), key=lambda kv: kv[1][0], reverse=True)[:n]
    if not ranked:
        return _a_reply(intent, f"No {label.split(' by')[0]} records found for this business yet.", suggestions=AI_EXAMPLES["ar" if not vendors else "ap"][:3])
    rows = [[str(k + 1), names.get(c, c), str(v[1]), _ainr(v[0])] for k, (c, v) in enumerate(ranked)]
    return _a_reply(intent, f"Top {len(ranked)} {label}, from {sum(v[1] for _, v in ranked)} records (excluding drafts and rejected).",
                    _a_table(["#", "Party", "Records", "Total"], rows, (0, 2, 3)), ["Who owes me the most?", "What is overdue?"])


def _a_sales(sb, org, role, text):
    t0 = datetime.date.today()
    last = bool(re.search(r"last month|previous month|पिछले महीने|पिछला महीना|pichle mahine|pichhle mahine", text))
    first = t0.replace(day=1)
    if last:
        first = (first - datetime.timedelta(days=1)).replace(day=1)
    prefix = first.isoformat()[:7]
    label = first.strftime("%B %Y")
    if role in ("ap", "approver"):
        rows = [b for b in sb.select("bills", "*", {"buyer": eq(org)}) if b["received_date"][:7] == prefix and b["status"] != "Rejected"]
        total = sum((_adec(b["amount"]) for b in rows), Decimal(0))
        return _a_reply("sales_month", f"This business is a buyer, so here are purchases: {len(rows)} bills received in {label} worth {_ainr(total)}.",
                        _a_table(["Bill", "Vendor", "Amount"], [[b["id"], biz_name(sb, b["vendor"]), _ainr(b["amount"])] for b in rows[:8]], (2,)) if rows else None,
                        ["Bills needing approval", "Which bills are due this week?"])
    rows = [i for i in _a_ar_rows(sb, org) if i["issue_date"][:7] == prefix]
    total = sum((_adec(i["total"]) for i in rows), Decimal(0))
    paid = sum((_adec(i.get("amount_paid")) for i in rows), Decimal(0))
    if not rows:
        return _a_reply("sales_month", f"No invoices were issued in {label}.", suggestions=["Top 5 customers by sales", "What is overdue?"])
    return _a_reply("sales_month", f"{label}: {len(rows)} invoices issued, {_ainr(total)} invoiced (incl. GST), {_ainr(paid)} collected so far.",
                    _a_table(["Invoice", "Customer", "Status", "Total"], [[i["id"], biz_name(sb, i["customer"]), i["status"], _ainr(i["total"])] for i in
                                                                          sorted(rows, key=lambda x: _adec(x["total"]), reverse=True)[:8]], (3,)),
                    ["Top 5 customers by sales", "Who owes me the most?"])


def _a_overdue(sb, org, role, text, payables):
    t0 = today()
    if payables:
        rows = sorted([b for b in _a_open_ap(sb, org) if b["due_date"] < t0], key=lambda b: b["due_date"])
        if not rows:
            return _a_reply("overdue_bills", "No bills are past their due date.", suggestions=["Which bills are due this week?"])
        total = sum((_adec(b["amount"]) for b in rows), Decimal(0))
        return _a_reply("overdue_bills", f"{len(rows)} bills are past due, {_ainr(total)} in total.",
                        _a_table(["Bill", "Vendor", "Due", "Days late", "Amount"], [[b["id"], biz_name(sb, b["vendor"]), b["due_date"], str(_a_late(b["due_date"])), _ainr(b["amount"])] for b in rows[:10]], (3, 4)),
                        ["Which bills are due this week?", "Bills needing approval"])
    rows = sorted([i for i in _a_open_ar(sb, org) if i["due_date"] < t0 or i["status"] == "Overdue"],
                  key=lambda i: _aout(i) * (_a_late(i["due_date"]) + 1), reverse=True)
    if not rows:
        return _a_reply("overdue", "Nothing is overdue. Every open invoice is within its due date.", suggestions=["Who owes me the most?", "Cash position"])
    total = sum((_aout(i) for i in rows), Decimal(0))
    return _a_reply("overdue", f"{len(rows)} invoices are overdue, {_ainr(total)} outstanding.",
                    _a_table(["Invoice", "Customer", "Due", "Days late", "Outstanding"], [[i["id"], biz_name(sb, i["customer"]), i["due_date"], str(_a_late(i["due_date"])), _ainr(_aout(i))] for i in rows[:10]], (3, 4)),
                    ["Remind overdue customers", "Who owes me the most?"])


def _a_week(sb, org):
    t0, t1 = today(), iso_from(dnum(today()) + 7)
    rows = sorted([b for b in _a_open_ap(sb, org) if t0 <= b["due_date"] <= t1], key=lambda b: b["due_date"])
    if not rows:
        return _a_reply("bills_due_week", "No open bills fall due in the next 7 days.", suggestions=["What is overdue?", "Bills needing approval"])
    total = sum((_adec(b["amount"]) for b in rows), Decimal(0))
    return _a_reply("bills_due_week", f"{len(rows)} bill{'s are' if len(rows) != 1 else ' is'} due in the next 7 days, {_ainr(total)} in total.",
                    _a_table(["Bill", "Vendor", "Due", "Status", "Amount"], [[b["id"], biz_name(sb, b["vendor"]), b["due_date"], b["status"], _ainr(b["amount"])] for b in rows], (4,)),
                    ["What is overdue?", "Bills needing approval"])


def _a_owes(sb, org, role, payables):
    names = {b["id"]: b["name"] for b in sb.select("businesses", "id,name")}
    totals = {}
    if payables:
        for b in _a_open_ap(sb, org):
            t = totals.setdefault(b["vendor"], [Decimal(0), 0])
            t[0] += _adec(b["amount"])
            t[1] += 1
        head_, who = "You owe", "vendors"
    else:
        for i in _a_open_ar(sb, org):
            t = totals.setdefault(i["customer"], [Decimal(0), 0])
            t[0] += _aout(i)
            t[1] += 1
        head_, who = "Owed to you by", "customers"
    ranked = sorted(totals.items(), key=lambda kv: kv[1][0], reverse=True)[:5]
    if not ranked:
        return _a_reply("who_owes", "Nothing is outstanding right now.", suggestions=["Cash position"])
    grand = sum((v[0] for v in totals.values()), Decimal(0))
    top = ranked[0]
    return _a_reply("who_owes", f"{names.get(top[0], top[0])} is the largest at {_ainr(top[1][0])}. {head_} {len(totals)} {who}: {_ainr(grand)} in total.",
                    _a_table(["Party", "Open records", "Outstanding"], [[names.get(c, c), str(v[1]), _ainr(v[0])] for c, v in ranked], (1, 2)),
                    ["What is overdue?", "Remind overdue customers"] if not payables else ["Which bills are due this week?"])


def _a_cash(sb, org):
    opening = _adec(org_settings(sb, org).get("opening_balance"))
    ar = sum((_aout(i) for i in _a_open_ar(sb, org) if i["status"] != "Dispute"), Decimal(0))
    held = sum((_aout(i) for i in _a_open_ar(sb, org) if i["status"] == "Dispute"), Decimal(0))
    ap = sum((_adec(b["amount"]) for b in _a_open_ap(sb, org)), Decimal(0))
    net = opening + ar - ap
    rows = [["Opening balance (demo setting)", _ainr(opening)], ["Receivables outstanding", _ainr(ar)], ["On hold in disputes (not counted)", _ainr(held)],
            ["Payables open", _ainr(ap)], ["Projected net if all settle", _ainr(net)]]
    return _a_reply("cash_position", f"Projected net position {_ainr(net)}: opening {_ainr(opening)} plus receivables {_ainr(ar)} minus payables {_ainr(ap)}. "
                    "This is arithmetic on demo records, not a bank balance.", _a_table(["Item", "Amount"], rows, (1,)),
                    ["What is overdue?", "Which bills are due this week?"])


def _a_approvals(sb, org):
    rows = sorted([b for b in _a_open_ap(sb, org) if b["status"] == "Needs approval"], key=lambda b: b["due_date"])
    if not rows:
        return _a_reply("bills_approval", "No bills are waiting for approval.", suggestions=["Which bills are due this week?"])
    total = sum((_adec(b["amount"]) for b in rows), Decimal(0))
    return _a_reply("bills_approval", f"{len(rows)} bills need approval, {_ainr(total)} in total.",
                    _a_table(["Bill", "Vendor", "Due", "Amount"], [[b["id"], biz_name(sb, b["vendor"]), b["due_date"], _ainr(b["amount"])] for b in rows], (3,)),
                    [f"Approve {rows[0]['id']}", "Which bills are due this week?"])


def _a_lookup(sb, org, raw, is_bill):
    row = _a_find(sb, "bills" if is_bill else "invoices", raw)
    mine = row and (row["buyer"] == org if is_bill else org in (row["supplier"], row["customer"]))
    if not mine:
        return _a_reply("lookup", f"I could not find {raw.upper()} in this business.", suggestions=AI_EXAMPLES["ap" if is_bill else "ar"][:3])
    if is_bill:
        return _a_reply("lookup", f"{row['id']}: {row['vendor']}, {_ainr(row['amount'])}, status {row['status']}, due {row['due_date']}.",
                        suggestions=[f"Approve {row['id']}"] if row["status"] == "Needs approval" else [])
    return _a_reply("lookup", f"{row['id']}: {row['customer']}, {_ainr(row['total'])} (outstanding {_ainr(_aout(row))}), status {row['status']}, due {row['due_date']}.",
                    suggestions=[f"Mark {row['id']} as paid"] if row["status"] in OPEN_AR else [])


# ---- staging
def _a_stage(sb, org, role, text, intent, kind, payload, title, record, changes):
    aid = "ai_" + uuid.uuid4().hex[:10]
    sb.insert("ai_action", {"id": aid, "org": org, "actor": org, "role": role, "input_text": text, "intent": intent, "kind": kind,
                            "payload": json.dumps(dict(payload, summary=title), ensure_ascii=False), "status": "Proposed",
                            "result_text": "", "created_at": now(), "decided_at": ""})
    card = {"id": aid, "kind": kind, "title": title, "record": record, "changes": changes,
            "permitted": [AI_ROLE_LABEL[r] for r in AI_KIND_ROLES[kind]], "roles": list(AI_KIND_ROLES[kind]), "note": "Nothing changes until a permitted person confirms."}
    return _a_reply(intent, "I have prepared this change. Review it and confirm, or cancel. Nothing has been changed yet.",
                    actions=[card], staged=True)


def _a_refuse(intent, role, kind):
    who = ", ".join(AI_ROLE_LABEL[r] for r in AI_KIND_ROLES[kind])
    return _a_reply(intent, f"Your role ({AI_ROLE_LABEL.get(role, role)}) cannot make this change. It can be confirmed by: {who}.")


def _a_stage_paid(sb, org, role, text, raw):
    if role not in AI_KIND_ROLES["invoice_paid"]:
        return _a_refuse("mark_paid", role, "invoice_paid")
    inv = _a_find(sb, "invoices", raw)
    if not inv or inv["supplier"] != org:
        return _a_reply("mark_paid", f"I could not find {raw.upper()} among your sales invoices.", suggestions=["What is overdue?"])
    if inv["status"] == "Paid":
        return _a_reply("mark_paid", f"{inv['id']} is already marked Paid.")
    if "Paid" not in INVOICE_TRANSITIONS.get(inv["status"], set()):
        why = " The buyer has to approve it first." if inv["status"] in ("Sent", "Viewed", "Pending approval") else ""
        return _a_reply("mark_paid", f"{inv['id']} is {inv['status']}, and an invoice cannot move from {inv['status']} to Paid.{why}",
                        suggestions=["What is overdue?"])
    if "share_payment_status" not in connection_scopes(sb, inv["supplier"], inv["customer"]):
        return _a_reply("mark_paid", "Payment status sharing is not enabled for this connection, so it cannot be recorded.")
    cust = biz_name(sb, inv["customer"])
    return _a_stage(sb, org, role, text, "mark_paid", "invoice_paid", {"invoice_id": inv["id"]}, f"Mark {inv['id']} as Paid",
                    f"{inv['id']} · {cust} · {_ainr(inv['total'])}",
                    [f"Invoice status: {inv['status']} → Paid", f"Records {_ainr(_aout(inv))} as received (demo, no money moves)",
                     f"Updates {cust}'s linked bill and notifies them", "Adds a row to the invoice activity trail"])


def _a_stage_approve(sb, org, role, text, raw):
    if role not in AI_KIND_ROLES["bill_approve"]:
        return _a_refuse("approve_bill", role, "bill_approve")
    bill = _a_find(sb, "bills", raw)
    if not bill or bill["buyer"] != org:
        return _a_reply("approve_bill", f"I could not find {raw.upper()} in your bills.", suggestions=["Bills needing approval"])
    if bill["status"] != "Needs approval":
        return _a_reply("approve_bill", f"{bill['id']} is {bill['status']}. Only bills in Needs approval can be approved.")
    limit = approval_threshold(sb, org)
    if limit and _adec(bill["amount"]) > limit and role != "approver":
        return _a_reply("approve_bill", f"{bill['id']} is above {_ainr(limit)}, so the approval rule requires the Approver.")
    vendor = biz_name(sb, bill["vendor"])
    return _a_stage(sb, org, role, text, "approve_bill", "bill_approve", {"bill_id": bill["id"]}, f"Approve {bill['id']}",
                    f"{bill['id']} · {vendor} · {_ainr(bill['amount'])}",
                    ["Bill status: Needs approval → Approved", "Syncs approval to the supplier's shared invoice", "Adds a row to the bill activity trail"])


def _a_stage_remind(sb, org, role, text):
    if role not in AI_KIND_ROLES["remind_overdue"]:
        return _a_refuse("remind_overdue", role, "remind_overdue")
    rows = sorted([i for i in _a_open_ar(sb, org) if i["status"] != "Dispute" and (i["due_date"] < today() or i["status"] == "Overdue")],
                  key=lambda i: _aout(i) * (_a_late(i["due_date"]) + 1), reverse=True)[:10]
    if not rows:
        return _a_reply("remind_overdue", "There are no overdue invoices to remind about. Disputed invoices are left out.")
    items, changes = [], []
    for i in rows:
        late = _a_late(i["due_date"])
        tone = "gentle" if late < 15 else "firm" if late < 30 else "final"
        items.append({"id": i["id"], "tone": tone})
        changes.append(f"{i['id']} · {biz_name(sb, i['customer'])} · {_ainr(_aout(i))} · {late} days late · {tone} tone")
    return _a_stage(sb, org, role, text, "remind_overdue", "remind_overdue", {"items": items}, f"Record {len(items)} payment reminders (demo)",
                    f"{len(items)} overdue invoices", changes + ["Reminders are recorded in the demo only. No email or message is sent."])


def _a_stage_meeting(sb, org, role, text):
    if role not in AI_KIND_ROLES["schedule_meeting"]:
        return _a_refuse("schedule_meeting", role, "schedule_meeting")
    low = text.lower()
    day = _a_date(low)
    if not day:
        return _a_reply("schedule_meeting", "Which day? For example: Schedule a meeting with Apex tomorrow 3pm.")
    if day < datetime.date.today():
        return _a_reply("schedule_meeting", "Meetings can't be scheduled in the past.")
    start = _a_time(low) or "10:00"
    h, mi = int(start[:2]), int(start[3:])
    end = f"{min(h + 1, 23):02d}:{mi:02d}" if h < 23 else "23:59"
    party = _a_party(sb, org, low)
    title = f"Meeting with {party['name']}" if party else "Meeting"
    return _a_stage(sb, org, role, text, "schedule_meeting", "schedule_meeting",
                    {"title": title, "start_date": day.isoformat(), "start_time": start, "end_time": end},
                    f"Schedule: {title}", f"{day.strftime('%a %d %b %Y')} · {start} to {end}",
                    [f"Adds a meeting to the {biz_name(sb, org)} calendar", "No invitation is sent in this demo"] + ([] if _a_time(low) else ["No time was given, so 10:00 is assumed"]))


def _a_next_invoice_id(sb):
    n = len(sb.select("invoices", "id")) + 901
    while True:
        iid = f"INV-{datetime.date.today().year}-{n:04d}"
        if not sb.one("invoices", "id", {"id": eq(iid)}):
            return iid
        n += 1


def _a_stage_invoice(sb, org, role, text):
    if role not in AI_KIND_ROLES["raise_invoice"]:
        return _a_refuse("raise_invoice", role, "raise_invoice")
    low = text.lower()
    cust = _a_party(sb, org, low)
    if not cust:
        return _a_reply("raise_invoice", "Which customer? For example: Raise invoice to Meridian for 50000 brand work.")
    amount, rest = _a_amount(low)
    if not amount or amount <= 0:
        return _a_reply("raise_invoice", "What amount? For example: Raise invoice to Meridian for 50000 brand work.")
    if "exchange_invoices" not in connection_scopes(sb, org, cust["id"]):
        return _a_reply("raise_invoice", f"Invoice sharing is not enabled with {cust['name']}, so an invoice cannot be sent.")
    tm = re.search(r"(\d{1,2})\s*%", rest)
    rate = Decimal(tm.group(1)) if tm and tm.group(1) in ("0", "5", "12", "18", "28") else Decimal(18)
    rest = re.sub(r"\d{1,2}\s*%|gst|\bat\b", " ", rest)
    rest = re.sub(r"\b(raise|create|make|generate|new|send|an?|the|invoice|invoices|to|for|of|banao|bana|do|please|rs|inr)\b|[₹बनाओ]|" + re.escape(cust["id"]) + "|" + re.escape(cust["name"].split()[0].lower()), " ", rest)
    desc = re.sub(r"\s+", " ", rest).strip(" ,.-:") or "Services"
    desc = desc[:200][0].upper() + desc[:200][1:]
    amount = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    gst = (amount * rate / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    due = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
    return _a_stage(sb, org, role, text, "raise_invoice", "raise_invoice",
                    {"customer": cust["id"], "description": desc, "rate": str(amount), "tax": str(rate), "due_date": due},
                    f"Raise invoice to {cust['name']}", f"{desc} · taxable {_ainr(amount)}",
                    [f"Taxable {_ainr(amount)} + GST {rate}% {_ainr(gst)} = total {_ainr(amount + gst)}", f"Issued today, due {due} (30 days)",
                     f"Number {_a_next_invoice_id(sb)} is assigned when you confirm", f"Shared with {cust['name']} and added to their bills inbox (demo, no email)"])


# ---- intent engine
def assistant_ask(sb, d):
    role, info, person = _a_actor(sb, d)
    org = info["org"]
    text = clean_text(d.get("text"), "Message", 300)
    t = re.sub(r"\s+", " ", text.lower())
    inv_m, bill_m = AI_INV_RE.search(t), AI_BILL_RE.search(t)
    payables = role in ("ap", "approver") or bool(re.search(r"\b(vendors?|suppliers?|payables?|bills?)\b|\bwe owe\b|\bi owe\b|विक्रेता|बिल", t))
    # --- actions (staged only)
    if inv_m and re.search(r"paid|received|settled|payment|भुगतान|मिल गया|मिला|\bmark\b", t):
        return _a_stage_paid(sb, org, role, text, inv_m.group(0))
    if bill_m and re.search(r"approv|मंजूर|मंज़ूर|अप्रूव|\bok\b|pass", t):
        return _a_stage_approve(sb, org, role, text, bill_m.group(0))
    if re.search(r"remind|nudge|chase|follow.?up|yaad|याद|रिमाइंडर", t):
        return _a_stage_remind(sb, org, role, text)
    if re.search(r"meeting|schedule|appointment|मीटिंग|book a call|set up a call", t):
        return _a_stage_meeting(sb, org, role, text)
    if re.search(r"(raise|create|make|generate|new|banao|बनाओ|बनाएं).{0,20}(invoice|इनवॉइस|bill)|invoice (to|for)", t) and not inv_m:
        return _a_stage_invoice(sb, org, role, text)
    # --- read-only questions
    if inv_m or bill_m:
        return _a_lookup(sb, org, (inv_m or bill_m).group(0), bool(bill_m and not inv_m))
    if re.search(r"approv|मंजूर|मंज़ूर|अप्रूव", t) and re.search(r"bill|बिल", t):
        return _a_approvals(sb, org)
    if re.search(r"bill|बिल|payable", t) and re.search(r"week|hafta|hafte|हफ्ते|हफ़्ते|सप्ताह|due|देय", t) and not re.search(r"overdue|past due|बकाया", t):
        return _a_week(sb, org)
    if re.search(r"\bowes?\b|\bowe\b|देना|देनदार|\bdena\b|udhaar|उधार|kaun.{0,20}(baaki|baki)|किसके.{0,12}बकाया|सबसे ज्यादा.{0,15}बकाया|biggest debtor", t):
        return _a_owes(sb, org, role, payables)
    if re.search(r"top|best|biggest|largest|highest|सबसे|बड़े|बड़ा|sabse", t) and re.search(r"customer|client|grahak|ग्राहक|कस्टमर|buyer|vendor|supplier|विक्रेता", t):
        return _a_top(sb, org, role, t, bool(re.search(r"vendor|supplier|विक्रेता", t)))
    if re.search(r"cash|balance|नकद|कैश|बैलेंस|position|liquidity", t):
        return _a_cash(sb, org)
    if re.search(r"sales|\bsale\b|revenue|turnover|बिक्री|बिक्रि|bikri|bikree|invoiced|कमाई", t):
        return _a_sales(sb, org, role, t)
    if re.search(r"overdue|over due|past due|\blate\b|baaki|\bbaki\b|बकाया|देर से|pending payment", t):
        return _a_overdue(sb, org, role, t, payables)
    ex = AI_EXAMPLES["ap" if role in ("ap", "approver") else "ar"]
    return _a_reply("fallback", "I did not understand that. I am a simple rule-based demo assistant that recognises a fixed set of questions and commands "
                    "(English, Hindi and Hinglish). Try one of the examples below.", suggestions=ex)


# ---- confirm / cancel
def _a_run(sb, row, role, org):
    p = json.loads(row["payload"] or "{}")
    kind = row["kind"]
    if kind == "invoice_paid":
        inv = sb.one("invoices", "*", {"id": eq(p["invoice_id"])})
        if not inv or inv["supplier"] != org:
            raise ApiError(404, "Invoice not found")
        patch_invoice_status(sb, inv["id"], {"status": "Paid", "actor": org, "role": role})
        return f"{inv['id']} marked Paid (demo, no money moved)."
    if kind == "bill_approve":
        bill = sb.one("bills", "*", {"id": eq(p["bill_id"])})
        if not bill or bill["buyer"] != org:
            raise ApiError(404, "Bill not found")
        patch_bill_status(sb, bill["id"], {"status": "Approved", "actor": org, "role": role})
        return f"{bill['id']} approved."
    if kind == "remind_overdue":
        done, skipped = 0, []
        for it in p.get("items", [])[:10]:
            inv = sb.one("invoices", "*", {"id": eq(str(it.get("id")))})
            if not inv or inv["supplier"] != org:
                skipped.append(str(it.get("id")))
                continue
            tone = it.get("tone") if it.get("tone") in TONES else "gentle"
            late = _a_late(inv["due_date"])
            body = REMINDER_TEXT[tone].format(name=biz_name(sb, inv["customer"]), iid=inv["id"], amount=inr(outstanding(inv)), due=inv["due_date"], late=late)
            try:
                send_reminder(sb, inv["id"], {"role": role, "actor": org, "tone": tone, "body": body})
                done += 1
            except ApiError:
                skipped.append(inv["id"])
        if not done:
            raise ApiError(409, "None of these invoices are open for collection any more")
        return f"{done} demo reminders recorded. Nothing was emailed." + (f" Skipped (no longer open): {', '.join(skipped)}." if skipped else "")
    if kind == "schedule_meeting":
        _, res = create_event(sb, {"role": role, "actor": org, "kind": "meeting", "title": p["title"],
                                   "description": "Scheduled from the demo assistant (rule-based). No invitation is sent.",
                                   "start_date": p["start_date"], "start_time": p["start_time"], "end_time": p["end_time"], "attendees": []})
        return f"Meeting added to the calendar ({p['start_date']} {p['start_time']})."
    if kind == "raise_invoice":
        iid = _a_next_invoice_id(sb)
        _, res = create_invoice(sb, {"id": iid, "supplier": org, "customer": p["customer"], "description": p["description"],
                                     "issue_date": today(), "due_date": p["due_date"], "qty": "1", "rate": p["rate"], "tax": p["tax"], "po_number": ""})
        return f"Invoice {iid} created and shared · total {_ainr(res['total'])}."
    raise ApiError(400, "Unknown action")


def _a_load(sb, d, cancel=False):
    role, info, person = _a_actor(sb, d)
    aid = clean_text(d.get("id"), "Proposal id", 40)
    if not re.fullmatch(r"ai_[A-Za-z0-9_]+", aid):
        raise ApiError(400, "Proposal id is not valid")
    row = sb.one("ai_action", "*", {"id": eq(aid)})
    if not row or row["org"] != info["org"]:  # another business's proposal looks the same as a missing one
        raise ApiError(404, "Proposal not found")
    if role not in AI_KIND_ROLES.get(row["kind"], ()) and not (cancel and role == row["role"]):
        raise ApiError(403, "This role cannot " + ("cancel" if cancel else "confirm") + " this change")
    if row["status"] != "Proposed":
        raise ApiError(409, f"This proposal is already {row['status'].lower()}")
    return role, info, person, row


def assistant_confirm(sb, d):
    role, info, person, row = _a_load(sb, d)
    # Claim first (compare-and-set) so a double click or a second tab can never execute twice.
    if not sb.update("ai_action", {"id": eq(row["id"]), "status": eq("Proposed")}, {"status": "Confirmed", "decided_at": now()}):
        raise ApiError(409, "This proposal was already decided")
    try:
        result = _a_run(sb, row, role, info["org"])
    except ApiError as e:
        sb.update("ai_action", {"id": eq(row["id"])}, {"status": "Failed", "result_text": e.message[:300]})
        raise
    except Exception:
        traceback.print_exc()
        sb.update("ai_action", {"id": eq(row["id"])}, {"status": "Failed", "result_text": "Unexpected error"})
        raise ApiError(500, "The demo server hit an unexpected error")
    result = f"{result} Confirmed by {person['name']}."
    sb.update("ai_action", {"id": eq(row["id"])}, {"result_text": result[:300]})
    return 200, {"ok": True, "id": row["id"], "status": "Confirmed", "result_text": result}


def assistant_cancel(sb, d):
    role, info, person, row = _a_load(sb, d, cancel=True)
    if not sb.update("ai_action", {"id": eq(row["id"]), "status": eq("Proposed")},
                     {"status": "Cancelled", "decided_at": now(), "result_text": f"Cancelled by {person['name']}."}):
        raise ApiError(409, "This proposal was already decided")
    return 200, {"ok": True, "id": row["id"], "status": "Cancelled"}


def assistant_activity(sb, query):
    org = (query.get("org", [""])[0] or "").strip()
    role = (query.get("role", [""])[0] or "").strip()
    actor = (query.get("actor", [""])[0] or "").strip() or org
    if not ORG_RE.fullmatch(org):
        raise ApiError(400, "Business is required")
    if role not in AI_ACTIVITY_ROLES:
        raise ApiError(403, "This role does not have access to assistant activity")
    calendar_actor(sb, {"role": role, "actor": actor}, org)
    rows = sb.select("ai_action", "*", {"org": eq(org)}, order="created_at.desc", limit=500)
    staff = {p["role_key"]: p for p in org_staff(sb, org)}
    items = []
    for r in rows:
        try:
            summary = json.loads(r["payload"] or "{}").get("summary", "")
        except ValueError:
            summary = ""
        who = staff.get(r["role"])
        items.append({"id": r["id"], "who": f"{who['name']} · {AI_ROLE_LABEL.get(r['role'], r['role'])}" if who else AI_ROLE_LABEL.get(r["role"], r["role"]),
                      "role": r["role"], "input_text": r["input_text"], "intent": r["intent"], "kind": r["kind"], "status": r["status"],
                      "summary": summary, "result_text": r["result_text"], "created_at": r["created_at"], "decided_at": r["decided_at"]})
    by_status = {k: sum(1 for r in rows if r["status"] == k) for k in ("Proposed", "Confirmed", "Cancelled", "Failed")}
    t0 = datetime.date.today()
    per_day = []
    for k in range(6, -1, -1):
        dd = (t0 - datetime.timedelta(days=k)).isoformat()
        per_day.append({"date": dd, "count": sum(1 for r in rows if r["created_at"][:10] == dd)})
    by_intent = {}
    for r in rows:
        by_intent[r["intent"]] = by_intent.get(r["intent"], 0) + 1
    pct = (Decimal(by_status["Confirmed"] * 100) / len(rows)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP) if rows else Decimal(0)
    return 200, {"org": org, "items": items, "label": "Demo: no tokens or model costs: rule-based",
                 "tiles": {"proposals": len(rows), "confirmed": by_status["Confirmed"], "confirmed_pct": float(pct), "cancelled": by_status["Cancelled"],
                           "failed": by_status["Failed"], "pending": by_status["Proposed"]},
                 "per_day": per_day, "by_intent": sorted(({"intent": k, "count": v} for k, v in by_intent.items()), key=lambda x: -x["count"])}


# --- END ASSISTANT -----------------------------------------------------------------------------------


SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Type": "application/json; charset=utf-8",
}


def dispatch(method, raw_path, headers, body):
    """Return (status, payload_dict). `headers` is a case-insensitive mapping, `body` bytes."""
    try:
        parsed = urlparse(raw_path)
        query = parse_qs(parsed.query)
        path = parsed.path
        # Vercel rewrites /api/* to /api/index?route=*, so prefer the original route when present.
        if "route" in query and path.rstrip("/") in ("/api/index", "/api"):
            path = "/api/" + query.pop("route")[0].strip("/")
        path = path.rstrip("/") or "/"

        if method in ("POST", "PATCH"):
            origin = headers.get("Origin") or ""
            host = headers.get("X-Forwarded-Host") or headers.get("Host") or ""
            if origin and urlparse(origin).netloc != host:
                raise ApiError(403, "Cross-site requests are not allowed")
            if "application/json" not in (headers.get("Content-Type") or "").lower():
                raise ApiError(415, "Send JSON with Content-Type: application/json")
            if len(body) > MAX_BODY:
                raise ApiError(413, "Request body must be under 100 KB")
            try:
                data = json.loads(body or b"{}")
            except (ValueError, UnicodeDecodeError):
                raise ApiError(400, "Request body is not valid JSON")
            if not isinstance(data, dict):
                raise ApiError(400, "JSON request body must be an object")
        elif method == "GET":
            data = None
        else:
            raise ApiError(405, "Method not allowed")

        sb = make_db()
        if method == "GET":
            if path == "/api/bootstrap":
                return bootstrap(sb)
            if path == "/api/health":
                return health(sb)
            if path == "/api/search":
                return search(sb, query)
            if path == "/api/calendar":
                return get_calendar(sb, query)
            if path == "/api/notifications":
                return get_notifications(sb, query)
            if path == "/api/insights/cashflow":
                return get_cashflow(sb, query)
            if path == "/api/insights/partners":
                return get_partners(sb, query)
            if path == "/api/collections":
                return get_collections(sb, query)
            if path == "/api/reconcile":
                return get_reconciliations(sb, query)
            if path == "/api/audit-pack":
                return get_audit_pack(sb, query)
            if path == "/api/gst":
                return get_gst(sb, query)
            if path == "/api/assistant/activity":
                return assistant_activity(sb, query)
            raise ApiError(404, "Not found")
        if method == "POST":
            if path == "/api/invoices":
                return create_invoice(sb, data)
            if path == "/api/businesses":
                return create_business(sb, data)
            if path == "/api/bills":
                return create_bill(sb, data)
            if path == "/api/calendar/events":
                return create_event(sb, data)
            if path == "/api/notifications/read":
                return read_notifications(sb, data)
            if path == "/api/settings/opening-balance":
                return set_opening_balance(sb, data)
            if path == "/api/settings/approval-rule":
                return set_approval_rule(sb, data)
            if path == "/api/reconcile/suggest":
                return reconcile_suggest(sb, data)
            if path == "/api/reconcile/confirm":
                return reconcile_confirm(sb, data)
            if path == "/api/assistant/ask":
                return assistant_ask(sb, data)
            if path == "/api/assistant/confirm":
                return assistant_confirm(sb, data)
            if path == "/api/assistant/cancel":
                return assistant_cancel(sb, data)
            if path == "/api/payment-runs/preview":
                return preview_run(sb, data)
            if path == "/api/payment-runs":
                return create_run(sb, data)
            m = re.fullmatch(r"/api/payment-runs/([^/]+)/mark-paid", path)
            if m:
                return mark_run_paid(sb, unquote(m.group(1)), data)
            m = re.fullmatch(r"/api/invoices/([^/]+)/reminders", path)
            if m:
                return send_reminder(sb, unquote(m.group(1)), data)
            m = re.fullmatch(r"/api/invoices/([^/]+)/promise", path)
            if m:
                return record_promise(sb, unquote(m.group(1)), data)
            m = re.fullmatch(r"/api/invoices/([^/]+)/comments", path)
            if m:
                return add_comment(sb, unquote(m.group(1)), data)
            m = re.fullmatch(r"/api/connections/([^/]+)/status", path)
            if m:
                return connection_status(sb, unquote(m.group(1)), data)
            raise ApiError(404, "Not found")
        m = re.fullmatch(r"/api/calendar/events/([^/]+)", path)
        if m:
            return patch_event(sb, unquote(m.group(1)), data)
        m = re.fullmatch(r"/api/bills/([^/]+)/status", path)
        if m:
            return patch_bill_status(sb, unquote(m.group(1)), data)
        m = re.fullmatch(r"/api/invoices/([^/]+)/status", path)
        if m:
            return patch_invoice_status(sb, unquote(m.group(1)), data)
        raise ApiError(404, "Not found")
    except ApiError as e:
        return e.status, {"error": e.message, "status": e.status}
    except Exception:
        traceback.print_exc()
        return 500, {"error": "The demo server hit an unexpected error", "status": 500}
