# Concierge

Knowledge-grounded, AI-drafted, **human-confirmed** customer service. Concierge ingests
inquiries, turns each into a ticket, and prepares a first-draft reply grounded in an indexed
brand knowledge base (**Brand Brain**). A rep reviews, edits, and sends — the tool never speaks
to a customer on its own. Brand-agnostic and multi-tenant: each brand runs as its own tenant on
one shared codebase.

> Formerly specced as "First Draft" — **renamed to Concierge** to avoid collision with the live
> Kids2 copywriting tool at firstdraft.scribechs.com. Design source: `FirstDraft-App-Design-Plan.md`.

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
