# InvoiceOS finance operating system demo

## Run locally

Requires Python 3.10 or newer. From this folder, run:

```sh
python3 server.py
```

Open the local URL printed by the server (it tries port 8765 first and moves to the next available port if needed). Stop with Ctrl+C. The app creates `invoiceos.sqlite3` on first run and keeps demo changes there.

## Demo path

Landing → role picker → role-specific dashboard. The role picker includes owner, finance manager, AR accountant, AP accountant, approver, buyer portal, vendor portal, and auditor. The nine-screen cut-line is represented by the landing page, role picker, dashboard, invoices, invoice detail, invoice builder, bills inbox, connections, and buyer portal. Approval and dispute views are also included.

Working interactions include invoice search and filtering, connected-business sharing scopes, buyer view tracking, a live GST split preview, AP bill capture with sample extraction fields, human approval steps, shared dispute replies, status history, and simulated payment-status recording. A buyer-side AP bill is created when a supplier shares an invoice; bill approval and payment status changes sync to the shared invoice. Approved AP bills can be scheduled and then marked paid in the demo. No real email, WhatsApp, GST submission, IRN generation, bank connection, or money movement occurs.

Internal roles also have **Team workload**, **Activity trail**, and **Flow insights** views. They summarize role-visible queues, recorded invoice events, due dates, approvals and exceptions. Mirrored invoice/bill records are deduplicated in the insight totals. The demo has no employee assignments, attendance tracking, or individual productivity scores; event actors are business accounts.

The landing page follows the dark, systems-first visual language of the Schoolverse reference, with an interactive Orb and figures derived from local sample records. The Orb connects invoices, bills, approvals, partners and role insights; hover, focus or tap an area to see how it links to the others, or drag the Orb to turn it. Motion respects the reduced-motion setting, and on narrow screens the areas become a tappable list under the Orb. The workspace keeps its light data canvas, dark module rail, compact tables and role switcher.

The original visual direction is documented in [FABLE_5_2_HANDOFF.md](FABLE_5_2_HANDOFF.md). The saved Orb implementation is now included on the landing page.

This is a local demo, not production software. It has no sign-in or tenant access controls; the role switcher is for demonstration only. Demo GSTINs, businesses and invoices are fictional and must not be used as real tax documents. The API applies basic input validation and participant checks to make demo workflows consistent, but those checks do not replace authentication or tenant isolation.
