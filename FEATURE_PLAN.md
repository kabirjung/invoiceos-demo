# InvoiceOS business features: build plan

Goal: make the demo feel like a working finance product for showing how it would look. Keep the current look and
module rail. New features arrive as new pages or panels using existing components. The demo stays honest: no real
money movement, GST filing, email or bank links. Every feature is labelled "Demo" where it simulates.

## Done: Calendar and work assignment (added before Phase 0)
- New **Calendar** tab for internal roles: month grid, day agenda, and an Assigned work table.
- Authorities (Owner, Finance Manager, Approver) schedule meetings and assign work with a completion date; everyone else is view-only, apart from moving their own task Open -> In progress -> Done. Auditor is read only; portal roles don't see it.
- Named fictional staff (`staff` table), always shown as "Name · Role". Tables: `staff`, `calendar_events` (SQLite in `api/_local.py`, Supabase in `supabase/migrations/003_calendar.sql`).
- API: `GET /api/calendar`, `POST /api/calendar/events`, `PATCH /api/calendar/events/{id}`; `/api/bootstrap` also returns `calendar_events` and `staff`.
- Simulated only: no invitations, emails or notifications are sent. Reassigning a task is supported by the API but has no UI yet.

## Ground rules
- Data comes from the existing tables (invoices, bills, connections, activity) plus the new tables below. No invented scores.
- Every mutation goes through `api/_core.py` and works on both SQLite (local) and Supabase (migration per phase).
- Each phase ships with: API endpoints, SQLite schema + Supabase migration, UI page, seeded demo data, tests, and a note in README.
- Each phase ends with a full UI + API regression run (same agents/method used in the last pass).

## Phase 0: Foundations (1 short pass, do first)
- `api/_core.py`: split into modules (`invoices`, `bills`, `connections`, `insights`) so new features don't bloat one file.
- Add a `GET /api/insights/*` read-only family computed server-side from existing rows (cashflow, scorecards, aging).
- Add `notifications` table + `GET /api/notifications`, `POST /api/notifications/read`. Written by existing mutations.
- Seed more history: ~25 invoices/bills across 90 days with realistic paid/overdue patterns so charts have shape.
- Front end: shared helpers for charts (small inline SVG, no library), money formatting, empty states.

## Phase 1: Cash and collections (highest demo impact)
1. **Cash-flow forecast** (Owner, Finance manager)
   - API: `GET /api/insights/cashflow?org=&days=90` returns weekly inflow (open invoices by due date) and outflow (open bills by due date).
   - UI: 30/60/90 chart; drag a bill's pay date (writes a `planned_pay_date` on the bill) and the projection updates.
2. **Collections workbench** (AR accountant)
   - Table: `reminders` (invoice_id, tone, body, promised_date, status, created_at).
   - API: `GET /api/collections?org=` ranks overdue invoices by amount x days late; `POST /api/invoices/{id}/reminders` stores a draft/"sent in demo" reminder; `POST .../promise` records a promise-to-pay date.
   - UI: ranked list, suggested gentle/firm/final text the user edits, promise countdown. Nothing is sent.
3. **Aging and DSO tiles** on the dashboards (0-30, 31-60, 61-90, 90+), computed from due dates.

## Phase 2: Payables control (AP side)
4. **Smart payment run**
   - Table: `payment_runs` (id, buyer, strategy, created_at, status) and `payment_run_items`.
   - API: `POST /api/payment-runs/preview` (strategy: by due date / max early discount / preserve cash) returns the plan; `POST /api/payment-runs` schedules the batch (existing Scheduled state, one activity row per bill); `POST .../{id}/mark-paid` simulates settlement.
   - UI: select approved bills, strategy picker, cash impact preview, "Schedule batch".
5. **Early-payment discounts**
   - Add `discount_pct`, `discount_days` to invoices (optional at creation, builder gets one optional field).
   - Bills inbox shows "earn Rs X by paying by <date>"; payment run strategy uses it.
6. **Approval rules**
   - Table: `approval_rules` (org, min_amount, required_approvers, new_vendor_flag).
   - Bills needing approval show the chain ("1 of 2 approved"); rule check enforced server-side in `patch_bill_status`.
   - Settings panel in the Owner role to edit thresholds.

## Phase 3: Collaboration between businesses
7. **Vendor/customer scorecards**: `GET /api/insights/partners?org=` computes avg days-to-pay, on-time %, dispute rate from `activity`. Shown on Connections.
8. **Three-way match**: add optional `purchase_orders` and `goods_receipts` tables (seeded for demo). Invoice detail shows PO / receipt / invoice columns with mismatches highlighted; a mismatch can pre-fill the dispute reason.
9. **Credit notes**: table `credit_notes` (invoice_id, amount, reason). Invoice detail shows balance after credits; both sides see it; totals in dashboards use the net amount.
10. **Payment promises and instalments**: buyer proposes a plan on an invoice (`payment_plans` table); supplier accepts/counters; schedule shown on cash-flow forecast.
11. **Shared invoice room polish**: presence ("viewed 2h ago" from existing view tracking), @mentions in comments, attachment names (metadata only).

## Phase 4: Compliance and audit
12. **Audit pack export**: `GET /api/audit-pack?org=` returns activity, approvals, status history as CSV (and a printable HTML page for PDF). Auditor role gets a download button.
13. **Anomaly flags**: rule-based and explained (duplicate vendor refs, amount far from vendor average, just under approval threshold). Each flag shows its rule; user can dismiss (`flags` table).
14. **GST summary preview**: monthly output vs input tax split CGST/SGST/IGST from invoice data; "ready for review" checklist. Labelled "Preview, no filing".
15. **Reconciliation demo**: upload a sample bank CSV (parsed in the browser), suggest matches to open invoices/bills by amount and reference, user confirms, which marks them paid in the demo.

## Phase 5: Interactivity polish
- Notification inbox in the topbar with unread count.
- What-if sliders on the cash-flow page ("if Meridian pays 10 days late").
- More command palette actions ("approve all under Rs 50,000", "remind overdue").
- Recurring invoices (`recurring_invoices` table, preview of next 3, a "run now" button that creates a real invoice).

## Suggested order and size
| Phase | Contents | Rough size |
|---|---|---|
| 0 | Foundations, notifications, richer seed | small |
| 1 | Cash-flow forecast, collections, aging | medium |
| 2 | Payment run, discounts, approval rules | medium |
| 3 | Scorecards, three-way match, credit notes, plans | large |
| 4 | Audit pack, anomalies, GST preview, reconciliation | medium |
| 5 | Polish and recurring invoices | small |

Run order for a demo-first build: Phase 0, then Phase 1 + payment run + scorecards (a coherent first demo), then the rest.

## Risks
- Every new table needs the SQLite schema, the Supabase migration (with RLS enabled and public access revoked, like migration 002) and `_local.py`'s table whitelist kept in sync.
- Multi-table writes are still non-atomic on Supabase. Payment runs and credit notes should move to database functions (RPC) before any real use.
- No sign-in: "actor" is still self-declared. Fine for the demo; must be solved before real data.
