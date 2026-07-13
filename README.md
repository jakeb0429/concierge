# Concierge

Knowledge-grounded, AI-drafted, **human-confirmed** customer service. Concierge ingests
inquiries, turns each into a ticket, and prepares a first-draft reply grounded in an indexed
brand knowledge base (**Brand Brain**). A rep reviews, edits, and sends — the tool never speaks
to a customer on its own. Brand-agnostic and multi-tenant: each brand runs as its own tenant on
one shared codebase.

> Formerly specced as "First Draft" — **renamed to Concierge** to avoid collision with the live
> Kids2 copywriting tool at firstdraft.scribechs.com. Design source: `FirstDraft-App-Design-Plan.md`.

## What it does

- **Grounded AI drafts** over the full thread (customer messages + our prior replies), scored for
  coverage (full/partial/none), cited to Brand Brain items. Rep confirms before anything sends.
- **Auto-escalation** — when the Brain can't answer, the agent asks the routed specialist and parks
  the ticket in `awaiting_internal`; the expert's answer grounds the re-draft and trains the Brain.
- **Order → Shopify checkout** — from a warranty/arm/exchange reply, the AI pre-fills line items;
  the rep revises a table (SKU · name · **live MSRP, editable** · qty · **per-line or per-order
  discount**), and a one-click checkout link (Shopify draft-order `invoiceUrl`, with tax breakdown)
  drops into the reply. Searchable product picker over the live orderable catalog. Shopify lives in
  the Birdseye app; Concierge calls it server-to-server (`BIRDSEYE_URL` + `BIRDSEYE_ADMIN_SECRET`).
- **Reopen + volley analytics** — a customer write-back re-surfaces a done ticket as the active
  `customer_replied` status (never hidden), and each ticket tracks `customerReplyCount` /
  `repReplyCount` to measure (and reduce) back-and-forth.
- **Inbox** — reply-state tagging, latest-message previews, time filters keyed off the customer's
  latest message, per-mailbox views.

### Pre-live safety (go-live switches)

Two env vars gate all outbound while testing — clear/flip both to go live:
`EMAIL_REDIRECT_TO` reroutes **all** notification + customer-reply email to one address (magic-link
sign-in exempt); `CONCIERGE_LIVE_SEND=true` is additionally required to transmit customer replies.

## Run it

```bash
cp .env.example .env   # fill in credentials
npm ci
npm run dev            # :3014
```

Quality gate (required green before any deploy): `npm run predeploy-check`
(typecheck → lint → test → build; same sequence CI runs).

Deploy: rsync the repo to birdseye, then `bash /opt/concierge/scripts/deploy-birdseye.sh`
(builds, restarts PM2, installs nginx + all crons — idempotent).

## Where things are documented

- **`CLAUDE.md`** — conventions, commands, migration workflow, the standards checklist
- **`docs/HANDOFF.md`** — architecture, credentials map, runbooks, feature inventory (read first)
- **`docs/BACKUP-RECOVERY.md`** — what's backed up and exactly how to restore
- **`docs/archive/`** — dated audits and reviews (historical record, not current truth)

Engineering standards: `iCloud/Claude/DEVELOPMENT-STANDARDS.md` (Tier 2).
