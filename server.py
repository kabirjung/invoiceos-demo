#!/usr/bin/env python3
"""InvoiceOS demo API backed by Supabase (PostgreSQL) via REST API."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
import json, uuid, datetime, re, os, errno, gzip, hashlib, time, traceback, urllib.request, urllib.error
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
TODAY = datetime.date.today().isoformat()
VERSION = "1.2.0"
STARTED_AT = time.time()


class SupabaseError(Exception):
    def __init__(self, message, status=500):
        super().__init__(message)
        self.status = status


class SB:
    """Tiny Supabase/PostgREST REST client using stdlib urllib."""

    def __init__(self):
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise SupabaseError(
                "SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) env vars are required",
                500,
            )
        self.base = f"{SUPABASE_URL}/rest/v1"
        self.h = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        }

    def _req(self, method, table, params=None, body=None, prefer=None):
        url = f"{self.base}/{table}"
        if params:
            parts = []
            for k, v in params.items():
                if v is not None:
                    parts.append(f"{k}={quote(str(v), safe='%.(),')}")
            if parts:
                url += "?" + "&".join(parts)
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = dict(self.h)
        if prefer:
            headers["Prefer"] = prefer
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                count = None
                cr = resp.headers.get("Content-Range", "")
                if cr and "/" in cr:
                    try:
                        count = int(cr.rsplit("/", 1)[-1])
                    except ValueError:
                        pass
                ctype = resp.headers.get("Content-Type", "")
                result = None
                if raw:
                    if "application/json" in ctype:
                        result = json.loads(raw.decode())
                    else:
                        result = raw.decode()
                return result, count
        except urllib.error.HTTPError as e:
            try:
                body_text = e.read().decode()
            except Exception:
                body_text = ""
            raise SupabaseError(f"Supabase {method} {table}: {e.code} {body_text[:300]}", e.code)
        except Exception as e:
            raise SupabaseError(f"Supabase {method} {table} error: {e}", 502)

    def select(self, table, columns="*", filters=None, order=None, limit=None, count=False):
        params = {"select": columns}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = str(limit)
        return self._req("GET", table, params=params, prefer="count=exact" if count else None)

    def insert(self, table, data):
        return self._req("POST", table, body=data, prefer="return=representation")

    def update(self, table, filters, data):
        return self._req("PATCH", table, params=filters, body=data, prefer="return=representation")


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def clean_text(value, label, limit, required=True):
    value = str(value or "").strip()
    if required and not value:
        raise ValueError(f"{label} is required")
    if len(value) > limit:
        raise ValueError(f"{label} must be {limit} characters or fewer")
    return value


def iso_date(value, label):
    value = clean_text(value, label, 10)
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{label} must be a valid date")
    return value


def decimal_value(value, label, *, minimum=Decimal("0"), maximum=Decimal("1000000000000")):
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, AttributeError):
        raise ValueError(f"{label} must be a valid number")
    if not number.is_finite() or number < minimum or number > maximum:
        raise ValueError(f"Check the {label.lower()} value")
    return number


def decimal_money(value, label):
    number = decimal_value(value, label).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if number <= 0:
        raise ValueError(f"{label} must be greater than zero")
    return number


def connection_scopes(sb, first, second):
    res, _ = sb.select(
        "connections",
        "scopes",
        filters={
            "and": f"((requester.eq.{first},target.eq.{second}),(requester.eq.{second},target.eq.{first}))",
            "status": "eq.Connected",
        },
        order="updated_at.desc",
        limit=1,
    )
    if not res:
        return set()
    try:
        return set(json.loads(res[0]["scopes"]))
    except (ValueError, TypeError, KeyError):
        return set()


class RequestTooLarge(ValueError):
    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "InvoiceOSDemo/1.2"
    protocol_version = "HTTP/1.1"

    def security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: blob:; connect-src 'self'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        )

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
        if urlparse(getattr(self, "path", "")).path.startswith("/api/"):
            try:
                return self.send_json(code, {"error": message or "Request failed", "status": code})
            except Exception:
                pass
        return super().send_error(code, message, explain)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 0:
            raise ValueError("Invalid content length")
        if size > 100_000:
            raise RequestTooLarge("Request body must be under 100 KB")
        try:
            data = json.loads(self.rfile.read(size) or b"{}")
        except json.JSONDecodeError:
            raise ValueError("Request body is not valid JSON")
        if not isinstance(data, dict):
            raise ValueError("JSON request body must be an object")
        return data

    def _sb(self):
        return SB()

    def do_GET(self):
        try:
            path = urlparse(self.path).path
            sb = self._sb()

            if path == "/api/bootstrap":
                businesses = sb.select("businesses", "*", order="name.asc")[0] or []
                invoices = sb.select("invoices", "*", order="created_at.desc")[0] or []
                comments = sb.select("comments", "*", order="created_at.asc")[0] or []
                activity = sb.select("activity", "*", order="created_at.desc")[0] or []
                bills = sb.select("bills", "*", order="created_at.desc")[0] or []
                bill_activity = sb.select("bill_activity", "*", order="created_at.desc")[0] or []
                connections = sb.select("connections", "*", order="created_at.desc")[0] or []
                return self.send_json(
                    200,
                    {
                        "businesses": businesses,
                        "invoices": invoices,
                        "comments": comments,
                        "activity": activity,
                        "bill_activity": bill_activity,
                        "bills": bills,
                        "connections": connections,
                    },
                )
            if path == "/api/health":
                counts = {}
                for table in ("businesses", "invoices", "bills", "connections"):
                    _, count = sb.select(table, "id", count=True, limit=0)
                    counts[table] = count or 0
                sb.select("businesses", "id", limit=1)  # verify connectivity
                return self.send_json(
                    200,
                    {
                        "ok": True,
                        "service": "InvoiceOS demo",
                        "version": VERSION,
                        "time": now(),
                        "uptime_seconds": round(time.time() - STARTED_AT, 1),
                        "database": {
                            "ok": True,
                            "engine": "postgresql (supabase)",
                            "journal_mode": "n/a",
                            "counts": counts,
                        },
                    },
                )
            if path == "/api/search":
                return self.search(sb)
            if path in ("/", "/index.html", "/demo", "/demo/"):
                return self.static("index.html", "text/html; charset=utf-8")
            if path == "/app.js":
                return self.static("app.js", "text/javascript; charset=utf-8")
            if path == "/favicon.ico":
                self.send_response(204)
                self.security_headers()
                self.end_headers()
                return
            return self.send_json(404, {"error": "Not found"})
        except (BrokenPipeError, ConnectionResetError):
            return
        except SupabaseError as e:
            try:
                self.send_json(e.status, {"error": str(e)})
            except Exception:
                pass
        except Exception:
            traceback.print_exc()
            try:
                self.send_json(500, {"error": "The demo server hit an unexpected error"})
            except Exception:
                pass

    do_HEAD = do_GET

    def search(self, sb):
        params = parse_qs(urlparse(self.path).query)
        query = (params.get("q", [""])[0] or "").strip()
        if len(query) > 80:
            query = query[:80]
        try:
            limit = max(1, min(25, int(params.get("limit", ["12"])[0])))
        except (TypeError, ValueError):
            limit = 12
        if not query:
            return self.send_json(200, {"query": "", "count": 0, "results": []})
        like_enc = quote(f"%{query}%", safe="%")
        results = []

        # Invoices with supplier/customer name expansion
        inv_filters = {
            "or": f"(id.ilike.{like_enc},description.ilike.{like_enc},po_number.ilike.{like_enc})",
            "order": "updated_at.desc,id.asc",
            "limit": str(limit),
        }
        inv_res, _ = sb.select(
            "invoices",
            "*,supplier:businesses(name),customer:businesses(name)",
            filters=inv_filters,
        )
        for r in (inv_res or []):
            if len(results) >= limit:
                break
            sup = r.get("supplier") or {}
            cus = r.get("customer") or {}
            results.append(
                {
                    "type": "invoice",
                    "id": r["id"],
                    "title": r["id"],
                    "subtitle": f"{sup.get('name', r.get('supplier', ''))} → {cus.get('name', r.get('customer', ''))}",
                    "meta": r["status"],
                    "detail": r["description"],
                    "amount": r["total"],
                    "date": r["due_date"],
                    "page": "detail",
                }
            )

        # Bills with vendor name expansion
        if len(results) < limit:
            bill_filters = {
                "or": f"(id.ilike.{like_enc},description.ilike.{like_enc},vendor_invoice_id.ilike.{like_enc})",
                "order": "created_at.desc,id.asc",
                "limit": str(limit - len(results)),
            }
            bill_res, _ = sb.select(
                "bills", "*,vendor:businesses(name)", filters=bill_filters
            )
            for r in (bill_res or []):
                if len(results) >= limit:
                    break
                ven = r.get("vendor") or {}
                results.append(
                    {
                        "type": "bill",
                        "id": r["id"],
                        "title": r["id"],
                        "subtitle": f"{ven.get('name', r.get('vendor', ''))} · {r.get('vendor_invoice_id', '')}",
                        "meta": r["status"],
                        "detail": r["description"],
                        "amount": r["amount"],
                        "date": r["due_date"],
                        "page": "bills",
                    }
                )

        # Businesses
        if len(results) < limit:
            biz_filters = {
                "or": f"(name.ilike.{like_enc},city.ilike.{like_enc},gstin.ilike.{like_enc})",
                "order": "name.asc",
                "limit": str(limit - len(results)),
            }
            biz_res, _ = sb.select("businesses", "*", filters=biz_filters)
            for r in (biz_res or []):
                if len(results) >= limit:
                    break
                results.append(
                    {
                        "type": "business",
                        "id": r["id"],
                        "title": r["name"],
                        "subtitle": " · ".join(x for x in (r.get("city", ""), r.get("gstin", "")) if x) or "Business profile",
                        "meta": r["kind"],
                        "detail": r.get("email", ""),
                        "page": "connections",
                    }
                )

        return self.send_json(200, {"query": query, "count": len(results), "results": results})

    def static(self, name, content_type):
        path = Path(__file__).resolve().parent / name
        if not path.is_file():
            return self.send_json(404, {"error": "Not found"})
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
        if body is not content:
            self.send_header("Content-Encoding", "gzip")
        self.security_headers()
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def method_not_allowed(self):
        return self.send_json(405, {"error": "Method not allowed"})

    do_PUT = method_not_allowed
    do_DELETE = method_not_allowed
    do_OPTIONS = method_not_allowed

    def do_POST(self):
        try:
            data = self.body()
            path = urlparse(self.path).path
            sb = self._sb()
            if path == "/api/invoices":
                return self.create_invoice(sb, data)
            if path == "/api/businesses":
                return self.create_business(sb, data)
            if path == "/api/bills":
                return self.create_bill(sb, data)
            m = re.fullmatch(r"/api/invoices/([^/]+)/comments", path)
            if m:
                return self.add_comment(sb, m.group(1), data)
            m = re.fullmatch(r"/api/connections/([^/]+)/status", path)
            if m:
                return self.connection_status(sb, m.group(1), data)
            return self.send_json(404, {"error": "Not found"})
        except RequestTooLarge as e:
            return self.send_json(413, {"error": str(e)})
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json(400, {"error": str(e)})
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        except Exception:
            traceback.print_exc()
            return self.send_json(500, {"error": "The demo server hit an unexpected error"})

    def create_invoice(self, sb, d):
        try:
            iid = clean_text(d.get("id"), "Invoice number", 40)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", iid):
                raise ValueError("Invoice number contains unsupported characters")
            customer = clean_text(d.get("customer"), "Customer", 80)
            supplier = clean_text(d.get("supplier", "northstar"), "Supplier", 80)
            description = clean_text(d.get("description"), "Description", 500)
            issue_date = iso_date(d.get("issue_date"), "Issue date")
            due_date = iso_date(d.get("due_date"), "Due date")
            if due_date < issue_date:
                raise ValueError("Due date can't be before the issue date")
            qty = decimal_value(d.get("qty"), "Quantity", minimum=Decimal("0.01"), maximum=Decimal("1000000"))
            rate = decimal_value(d.get("rate"), "Rate", maximum=Decimal("10000000000"))
            tax = decimal_value(d.get("tax"), "GST rate", maximum=Decimal("100"))
            if tax not in {Decimal("0"), Decimal("5"), Decimal("12"), Decimal("18"), Decimal("28")}:
                raise ValueError("Choose a GST rate shown in the invoice form")
            po_number = clean_text(d.get("po_number", ""), "Purchase order", 100, required=False)
            total = (qty * rate * (Decimal("1") + tax / Decimal("100"))).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            if total > Decimal("1000000000000"):
                raise ValueError("Invoice total is above the demo limit")
        except (ValueError, TypeError) as e:
            return self.send_json(400, {"error": str(e)})
        stamp = now()
        try:
            existing = sb.select("invoices", "id", filters={"id": f"eq.{iid}"}, limit=1)[0]
            if existing:
                return self.send_json(409, {"error": "Invoice number already exists"})
            biz = sb.select("businesses", "*", filters={"id": f"eq.{customer}"}, limit=1)[0]
            if not biz:
                return self.send_json(400, {"error": "Choose a connected customer"})
            sup = sb.select("businesses", "*", filters={"id": f"eq.{supplier}"}, limit=1)[0]
            if not sup:
                return self.send_json(400, {"error": "Supplier is not registered in this demo"})
            scopes = connection_scopes(sb, supplier, customer)
            if "exchange_invoices" not in scopes:
                return self.send_json(403, {"error": "Connect with this business and enable invoice sharing before sending"})
            sb.insert(
                "invoices",
                {
                    "id": iid,
                    "supplier": supplier,
                    "customer": customer,
                    "supplier_gstin": sup["gstin"],
                    "customer_gstin": biz["gstin"],
                    "issue_date": issue_date,
                    "due_date": due_date,
                    "po_number": po_number,
                    "description": description,
                    "qty": float(qty),
                    "rate": float(rate),
                    "tax": float(tax),
                    "total": float(total),
                    "status": "Sent",
                    "dispute_reason": "",
                    "created_at": stamp,
                    "updated_at": stamp,
                },
            )
            sb.insert(
                "activity",
                {
                    "invoice_id": iid,
                    "actor": supplier,
                    "action": "Invoice sent",
                    "detail": biz["name"],
                    "created_at": stamp,
                },
            )
            bill_id = "BILL-" + uuid.uuid4().hex[:8].upper()
            sb.insert(
                "bills",
                {
                    "id": bill_id,
                    "buyer": customer,
                    "vendor": supplier,
                    "vendor_invoice_id": iid,
                    "received_date": issue_date,
                    "due_date": due_date,
                    "po_number": po_number,
                    "description": description,
                    "amount": float(total),
                    "source": "network",
                    "status": "Received",
                    "ocr_confidence": 1.0,
                    "created_at": stamp,
                },
            )
            sb.insert(
                "bill_activity",
                {
                    "bill_id": bill_id,
                    "actor": supplier,
                    "action": "Bill received",
                    "detail": f"Created from shared invoice {iid}",
                    "created_at": stamp,
                },
            )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(201, {"ok": True, "total": float(total), "bill_id": bill_id})

    def add_comment(self, sb, iid, d):
        body_text = str(d.get("body", "")).strip()
        if not body_text:
            return self.send_json(400, {"error": "Write a reply first"})
        if len(body_text) > 2000:
            return self.send_json(400, {"error": "Reply must be under 2,000 characters"})
        try:
            inv = sb.select("invoices", "supplier,customer", filters={"id": f"eq.{iid}"}, limit=1)[0]
            if not inv:
                return self.send_json(404, {"error": "Invoice not found"})
            actor = d.get("actor", "northstar")
            if actor not in {inv["supplier"], inv["customer"]}:
                return self.send_json(403, {"error": "Only the invoice participants can reply"})
            scopes = connection_scopes(sb, inv["supplier"], inv["customer"])
            if "exchange_invoices" not in scopes:
                return self.send_json(403, {"error": "Invoice sharing is not active for this business pair"})
            stamp = now()
            sb.insert(
                "comments",
                {"invoice_id": iid, "actor": actor, "body": body_text, "created_at": stamp},
            )
            sb.insert(
                "activity",
                {
                    "invoice_id": iid,
                    "actor": actor,
                    "action": "Comment added",
                    "detail": body_text[:120],
                    "created_at": stamp,
                },
            )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(201, {"ok": True})

    def create_business(self, sb, d):
        name = str(d.get("name", "")).strip()
        email = str(d.get("email", "")).strip()
        if not name or len(name) > 120:
            return self.send_json(400, {"error": "Enter a business name (up to 120 characters)"})
        email = email[:160]
        gstin = str(d.get("gstin", "")).strip().upper()
        requester = str(d.get("requester", "northstar")).strip()
        scopes = d.get("scopes", ["exchange_invoices", "share_payment_status"])
        allowed_scopes = {"exchange_invoices", "share_payment_status"}
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            return self.send_json(400, {"error": "Enter a valid business email"})
        if gstin and not re.fullmatch(r"[0-9]{2}[A-Z0-9]{13}", gstin):
            return self.send_json(400, {"error": "GSTIN must contain 15 letters and numbers"})
        if not isinstance(scopes, list) or not scopes or any(s not in allowed_scopes for s in scopes):
            return self.send_json(400, {"error": "Choose at least one supported sharing scope"})
        bid = "biz_" + uuid.uuid4().hex[:10]
        stamp = now()
        try:
            if not sb.select("businesses", "id", filters={"id": f"eq.{requester}"}, limit=1)[0]:
                return self.send_json(400, {"error": "Requesting business is not registered in this demo"})
            if gstin and sb.select("businesses", "id", filters={"gstin": f"eq.{gstin}"}, limit=1)[0]:
                return self.send_json(409, {"error": "A business with this GSTIN is already in the demo network"})
            sb.insert(
                "businesses",
                {
                    "id": bid,
                    "name": name,
                    "kind": "invited",
                    "city": str(d.get("city", ""))[:80],
                    "gstin": gstin,
                    "email": email,
                    "created_at": stamp,
                },
            )
            sb.insert(
                "connections",
                {
                    "id": "conn_" + uuid.uuid4().hex[:10],
                    "requester": requester,
                    "target": bid,
                    "status": "Pending",
                    "scopes": json.dumps(scopes),
                    "created_at": stamp,
                    "updated_at": stamp,
                },
            )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(201, {"ok": True, "id": bid})

    def connection_status(self, sb, cid, d):
        status = d.get("status")
        if status not in {"Connected", "Declined", "Revoked"}:
            return self.send_json(400, {"error": "Unsupported connection status"})
        try:
            conn = sb.select("connections", "*", filters={"id": f"eq.{cid}"}, limit=1)[0]
            if not conn:
                return self.send_json(404, {"error": "Connection not found"})
            actor = d.get("actor", conn["target"])
            if status in {"Connected", "Declined"} and actor not in {conn["target"], conn["requester"]}:
                return self.send_json(403, {"error": "Only a connection participant can respond"})
            if status == "Revoked" and actor not in {conn["target"], conn["requester"]}:
                return self.send_json(403, {"error": "Only a connection participant can revoke it"})
            if status in {"Connected", "Declined"} and conn["status"] != "Pending":
                return self.send_json(409, {"error": "This request is no longer pending"})
            if status == "Revoked" and conn["status"] != "Connected":
                return self.send_json(409, {"error": "Only an active connection can be revoked"})
            sb.update("connections", {"id": f"eq.{cid}"}, {"status": status, "updated_at": now()})
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(200, {"ok": True})

    def create_bill(self, sb, d):
        try:
            vendor = clean_text(d.get("vendor"), "Vendor", 80)
            reference = clean_text(d.get("vendor_invoice_id"), "Vendor invoice number", 80)
            description = clean_text(d.get("description"), "Description", 500)
            due_date = iso_date(d.get("due_date"), "Due date")
            received_date = iso_date(d.get("received_date", TODAY), "Received date")
            po_number = clean_text(d.get("po_number", ""), "Purchase order", 100, required=False)
            amount = float(decimal_money(d.get("amount"), "Bill amount"))
            source = clean_text(d.get("source", "manual"), "Bill source", 20)
            if source not in {"manual", "upload"}:
                raise ValueError("Choose a supported bill source")
            confidence = decimal_value(d.get("ocr_confidence", 0), "Extraction confidence", maximum=Decimal("1"))
            buyer = clean_text(d.get("buyer", "meridian"), "Buyer", 80)
        except (ValueError, TypeError) as e:
            return self.send_json(400, {"error": str(e)})
        bid = "BILL-" + uuid.uuid4().hex[:8].upper()
        try:
            existing = sb.select(
                "bills",
                "id",
                filters={"and": f"(buyer.eq.{buyer},vendor.eq.{vendor},vendor_invoice_id.eq.{reference})"},
                limit=1,
            )[0]
            if existing:
                return self.send_json(409, {"error": "A bill with this vendor invoice number already exists"})
            if not sb.select("businesses", "id", filters={"id": f"eq.{vendor}"}, limit=1)[0]:
                return self.send_json(400, {"error": "Choose a connected vendor"})
            scopes = connection_scopes(sb, buyer, vendor)
            if "exchange_invoices" not in scopes:
                return self.send_json(403, {"error": "Connect with this vendor and enable invoice sharing before adding a bill"})
            stamp = now()
            sb.insert(
                "bills",
                {
                    "id": bid,
                    "buyer": buyer,
                    "vendor": vendor,
                    "vendor_invoice_id": reference,
                    "received_date": received_date,
                    "due_date": due_date,
                    "po_number": po_number,
                    "description": description,
                    "amount": amount,
                    "source": source,
                    "status": "Received",
                    "ocr_confidence": float(confidence),
                    "created_at": stamp,
                },
            )
            sb.insert(
                "bill_activity",
                {
                    "bill_id": bid,
                    "actor": buyer,
                    "action": "Bill received",
                    "detail": f"Added to AP inbox · {source} entry",
                    "created_at": stamp,
                },
            )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(201, {"ok": True, "id": bid})

    def log_message(self, *_: object) -> None:
        pass

    def do_PATCH(self):
        try:
            data = self.body()
            path = urlparse(self.path).path
            sb = self._sb()
            m = re.fullmatch(r"/api/bills/([^/]+)/status", path)
            if m:
                return self._patch_bill_status(sb, m.group(1), data)
            m = re.fullmatch(r"/api/invoices/([^/]+)/status", path)
            if m:
                return self._patch_invoice_status(sb, m.group(1), data)
            return self.send_json(404, {"error": "Not found"})
        except RequestTooLarge as e:
            return self.send_json(413, {"error": str(e)})
        except (ValueError, KeyError, TypeError) as e:
            return self.send_json(400, {"error": str(e)})
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        except Exception:
            traceback.print_exc()
            return self.send_json(500, {"error": "The demo server hit an unexpected error"})

    def _patch_bill_status(self, sb, bid, data):
        status = data.get("status")
        if status not in {"Received", "Needs approval", "Approved", "Rejected", "Scheduled", "Paid"}:
            return self.send_json(400, {"error": "Unsupported bill status"})
        try:
            bill = sb.select("bills", "*", filters={"id": f"eq.{bid}"}, limit=1)[0]
            if not bill:
                return self.send_json(404, {"error": "Bill not found"})
            if data.get("actor", bill["buyer"]) != bill["buyer"]:
                return self.send_json(403, {"error": "Only the buying business can update this bill"})
            transitions = {
                "Received": {"Needs approval"},
                "Needs approval": {"Approved", "Rejected"},
                "Approved": {"Scheduled", "Paid"},
                "Scheduled": {"Paid"},
                "Rejected": set(),
                "Paid": set(),
            }
            if status != bill["status"] and status not in transitions.get(bill["status"], set()):
                return self.send_json(409, {"error": f"A bill can't move from {bill['status']} to {status}"})
            sb.update("bills", {"id": f"eq.{bid}"}, {"status": status})
            if status != bill["status"]:
                sb.insert(
                    "bill_activity",
                    {
                        "bill_id": bid,
                        "actor": data.get("actor", bill["buyer"]),
                        "action": "Bill status changed",
                        "detail": f"{bill['status']} → {status}",
                        "created_at": now(),
                    },
                )
            linked_status = {"Needs approval": "Pending approval", "Approved": "Approved", "Rejected": "Rejected", "Paid": "Paid"}.get(status)
            if bill["source"] == "network" and linked_status:
                scopes = connection_scopes(sb, bill["buyer"], bill["vendor"])
                if "exchange_invoices" not in scopes or (status == "Paid" and "share_payment_status" not in scopes):
                    linked_status = None
            if bill["source"] == "network" and linked_status:
                inv = sb.select(
                    "invoices",
                    "id",
                    filters={"id": f"eq.{bill['vendor_invoice_id']}", "supplier": f"eq.{bill['vendor']}", "customer": f"eq.{bill['buyer']}"},
                    limit=1,
                )[0]
                if inv:
                    sb.update("invoices", {"id": f"eq.{inv['id']}"}, {"status": linked_status, "updated_at": now()})
                    sb.insert(
                        "activity",
                        {
                            "invoice_id": inv["id"],
                            "actor": bill["buyer"],
                            "action": linked_status,
                            "detail": "Bill workflow updated",
                            "created_at": now(),
                        },
                    )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(200, {"ok": True})

    def _patch_invoice_status(self, sb, iid, data):
        status = data.get("status")
        allowed = {"Draft", "Sent", "Viewed", "Pending approval", "Approved", "Partially paid", "Paid", "Overdue", "Dispute", "Resolved", "Rejected"}
        if status not in allowed:
            return self.send_json(400, {"error": "Unsupported invoice status"})
        try:
            invoice = sb.select("invoices", "*", filters={"id": f"eq.{iid}"}, limit=1)[0]
            if not invoice:
                return self.send_json(404, {"error": "Invoice not found"})
            actor = data.get("actor", invoice["supplier"])
            if actor not in {invoice["supplier"], invoice["customer"]}:
                return self.send_json(403, {"error": "Only the invoice participants can update its status"})
            scopes = connection_scopes(sb, invoice["supplier"], invoice["customer"])
            if "exchange_invoices" not in scopes:
                return self.send_json(403, {"error": "Invoice sharing is not active for this business pair"})
            if status in {"Paid", "Partially paid"} and "share_payment_status" not in scopes:
                return self.send_json(403, {"error": "Payment status sharing is not enabled for this connection"})
            transitions = {
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
            if status != invoice["status"] and status not in transitions.get(invoice["status"], set()):
                return self.send_json(409, {"error": f"An invoice can't move from {invoice['status']} to {status}"})
            reason = str(data.get("dispute_reason", ""))[:500]
            update_data = {"status": status, "updated_at": now()}
            if reason:
                update_data["dispute_reason"] = reason
            sb.update("invoices", {"id": f"eq.{iid}"}, update_data)
            sb.insert(
                "activity",
                {
                    "invoice_id": iid,
                    "actor": data.get("actor", "northstar"),
                    "action": status,
                    "detail": "Status updated",
                    "created_at": now(),
                },
            )
            bill_status = {"Pending approval": "Needs approval", "Approved": "Approved", "Paid": "Paid", "Rejected": "Rejected"}.get(status)
            if bill_status:
                scopes = connection_scopes(sb, invoice["supplier"], invoice["customer"])
                if "exchange_invoices" in scopes and (status != "Paid" or "share_payment_status" in scopes):
                    sb.update(
                        "bills",
                        {"and": f"(source.eq.network,buyer.eq.{invoice['customer']},vendor.eq.{invoice['supplier']},vendor_invoice_id.eq.{iid})"},
                        {"status": bill_status},
                    )
        except SupabaseError as e:
            return self.send_json(e.status, {"error": str(e)})
        return self.send_json(200, {"ok": True})


def ensure_seed(sb):
    """Seed demo data if tables are empty."""
    stamp = now()
    businesses = [
        ("northstar", "Northstar Studio", "supplier", "Bengaluru", "29AABCN1234A1Z5", "accounts@northstar.example", stamp),
        ("meridian", "Meridian Retail Pvt Ltd", "buyer", "Mumbai", "27AAMCM5678B2Z8", "ap@meridian.example", stamp),
        ("apex", "Apex Industrial Supply", "both", "Pune", "27AAAPA1111C1Z2", "finance@apex.example", stamp),
        ("trident", "Trident Auto Parts", "both", "Nashik", "27AABTT2222D1Z3", "accounts@trident.example", stamp),
    ]
    existing = sb.select("businesses", "id", limit=1)[0]
    if not existing:
        for b in businesses:
            sb.insert("businesses", {
                "id": b[0], "name": b[1], "kind": b[2], "city": b[3], "gstin": b[4], "email": b[5], "created_at": b[6]
            })
        # Seed invoices
        samples = [
            ("INV-2025-0842", "northstar", "meridian", "12 Feb 2025", "12 Mar 2025", "PO-MR-102", "Brand strategy and campaign design", 1, 210000, 18, "Dispute", "Deliverable scope query"),
            ("INV-2025-0841", "northstar", "apex", "11 Feb 2025", "13 Mar 2025", "PO-AP-203", "Website and product copywriting", 1, 149322, 18, "Paid", ""),
            ("INV-2025-0839", "northstar", "trident", "08 Feb 2025", "10 Mar 2025", "PO-TR-044", "Quarterly creative services", 1, 71895, 18, "Overdue", ""),
            ("INV-2025-0838", "northstar", "meridian", "07 Feb 2025", "09 Mar 2025", "PO-MR-101", "Retail launch campaign creative", 1, 264000, 18, "Dispute", "Quantity mismatch"),
            ("INV-2025-0835", "northstar", "apex", "04 Feb 2025", "06 Mar 2025", "PO-AP-199", "Brand identity refresh", 1, 105339, 18, "Sent", ""),
            ("INV-2025-0847", "apex", "meridian", "16 Feb 2025", "18 Mar 2025", "PO-MR-008", "Replacement pump set", 4, 94000, 18, "Pending approval", ""),
        ]
        biz_map = {b[0]: b for b in businesses}
        for item in samples:
            iid, supplier, customer, issue, due, po, desc, qty, rate, tax, status, reason = item
            s_gst = biz_map[supplier][4]
            c_gst = biz_map[customer][4]
            total = round(qty * rate * (1 + tax / 100), 2)
            sb.insert("invoices", {
                "id": iid, "supplier": supplier, "customer": customer,
                "supplier_gstin": s_gst, "customer_gstin": c_gst,
                "issue_date": issue, "due_date": due, "po_number": po,
                "description": desc, "qty": float(qty), "rate": float(rate), "tax": float(tax),
                "total": total, "status": status, "dispute_reason": reason,
                "created_at": stamp, "updated_at": stamp,
            })
            sb.insert("activity", {
                "invoice_id": iid, "actor": supplier, "action": "Invoice created", "detail": status, "created_at": stamp,
            })
        sb.insert("connections", {
            "id": "conn_northstar_meridian", "requester": "northstar", "target": "meridian",
            "status": "Connected", "scopes": json.dumps(["exchange_invoices", "share_payment_status"]),
            "created_at": stamp, "updated_at": stamp,
        })
        bills = [
            ("BILL-4521", "meridian", "northstar", "NS-2025-0192", "2025-02-16", "2025-03-18", "MR-PO-880", "Brand identity and campaign design", 186000, "network", "Needs approval", 0.99),
            ("BILL-4518", "meridian", "apex", "AP-2025-110", "2025-02-15", "2025-03-17", "MR-PO-870", "Packaging print run", 94400, "upload", "Received", 0.96),
            ("BILL-4512", "meridian", "trident", "TR-2025-044", "2025-02-13", "2025-03-15", "MR-PO-852", "Retail display fixtures", 225000, "email", "Needs approval", 0.93),
            ("BILL-4509", "meridian", "northstar", "NS-2025-0184", "2025-02-12", "2025-03-14", "MR-PO-841", "Product photography", 72000, "network", "Approved", 0.99),
        ]
        for b in bills:
            sb.insert("bills", {
                "id": b[0], "buyer": b[1], "vendor": b[2], "vendor_invoice_id": b[3],
                "received_date": b[4], "due_date": b[5], "po_number": b[6], "description": b[7],
                "amount": b[8], "source": b[9], "status": b[10], "ocr_confidence": b[11], "created_at": stamp,
            })
            sb.insert("bill_activity", {
                "bill_id": b[0], "actor": b[1], "action": "Bill received",
                "detail": f"Added to AP inbox · {b[9]} entry", "created_at": stamp,
            })


if __name__ == "__main__":
    try:
        sb = SB()
    except SupabaseError as e:
        print(f"Configuration error: {e}")
        print("Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) env vars")
        raise SystemExit(1)
    ensure_seed(sb)
    preferred = int(os.environ.get("INVOICEOS_PORT", "8765"))
    server = None
    for port in range(preferred, preferred + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError as e:
            if e.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise RuntimeError(f"No available local port between {preferred} and {preferred + 19}")
    print(f"InvoiceOS running at http://127.0.0.1:{port}")
    print(f"Supabase: {SUPABASE_URL}")
    server.serve_forever()
