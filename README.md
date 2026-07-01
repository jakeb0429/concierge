# Concierge

Knowledge-grounded, AI-drafted, **human-confirmed** customer service. Concierge ingests
inquiries, turns each into a ticket, and prepares a first-draft reply grounded in an indexed
brand knowledge base (**Brand Brain**). A rep reviews, edits, and sends — the tool never speaks
to a customer on its own. Brand-agnostic and multi-tenant: each brand runs as its own tenant on
one shared codebase.

> Formerly specced as "First Draft" — **renamed to Concierge** to avoid collision with the live
> Kids2 copywriting tool at firstdraft.scribechs.com. Design source: `FirstDraft-App-Design-Plan.md`.

## Locked build decisions

| Decision | Answer |
|---|---|
| First tenant | **Rheos** (dogfood) — Google Workspace, `hello@rheosgear.com` |
| Scope | **Full Phase 1**: live email read + send, with tag/folder/archive sync |
| Infra | **Birdseye** box; shared Postgres, own `concierge` schema + `pgvector`; separate Next app + PM2 (port 3014) |
| AI | Anthropic, model centralized in `src/lib/anthropic.ts` (`claude-opus-4-8`) |
| Seed | Mine HubSpot `hello@` tickets → FAQ candidates; crawl rheosgear.com; brand guidelines → voice guide |
| Second tenant | **Stingray** — Microsoft 365 (`support@stingrayboats.com`), via the Graph adapter |

## The Microsoft-ready seam (why Stingray is a config change, not a rewrite)

The core never imports `googleapis` or the Graph SDK. It only talks to one interface,
`ChannelAdapter` (`src/lib/channels/types.ts`). Two implementations sit behind it:

- `GmailAdapter` (`gmail.ts`) — **live** path for Rheos (Google Workspace).
- `GraphMailAdapter` (`graph.ts`) — **scaffolded** path for Stingray (M365). Satisfies the same
  interface today (compiled, present, throwing until wired), so the core, schema, and UI already
  support Microsoft. Onboarding Stingray = an Azure app registration + filling in the method bodies.

Every provider difference collapses to five operations: `ingest · send · tag · folder · archive`.
Gmail labels ↔ Outlook categories; Gmail label-move ↔ Graph `mailFolders` move; drop-INBOX ↔ move-to-Archive.

## Stack

- Next.js 16 (App Router, React 19, TypeScript, Tailwind 4)
- Prisma 6 + Postgres (`concierge` schema) with `pgvector` for the semantic index
- `@anthropic-ai/sdk` — classification + grounded drafting
- `googleapis` (Gmail) · `@microsoft/microsoft-graph-client` (M365)
- next-auth 5; PM2 on birdseye.scribechs.com

## Layout

```
prisma/schema.prisma          # Section 12 data model, multi-tenant + pgvector
prisma/seed.ts                # Rheos + Stingray tenants, Rheos Brand Brain
prisma/seed/rheos-brand-brain.ts  # voice guide + FAQ/policy/product from the brand docs
src/lib/channels/             # the provider-agnostic seam
  types.ts                    #   ChannelAdapter interface + normalized types
  gmail.ts                    #   Rheos (live)
  graph.ts                    #   Stingray (scaffolded, M365)
  index.ts                    #   provider -> adapter factory
src/lib/brain/
  retrieval.ts                # fast path (canonical) + smart path (pgvector)
  ingest.ts                   # HubSpot mining + site crawl -> FAQ candidates
src/lib/anthropic.ts          # centralized CLAUDE_MODEL
src/app/                      # UI (inbox → ticket → draft → confirm, next)
```

## Getting started

```bash
npm install
cp .env.example .env          # fill DATABASE_URL, ANTHROPIC_API_KEY, Rheos Gmail creds
npm run db:push               # creates the concierge schema + pgvector
npm run db:seed               # Rheos Brand Brain + both tenants
npm run dev                   # http://localhost:3014
```

## Roadmap

- **Now (scaffold):** data model, channel seam (Gmail + Graph), Rheos seed. ✅
- **Next:** inbox → ticket → draft → confirm UI over seeded knowledge; embeddings provider + retrieval.
- **Phase 1:** live Gmail intake/send + tag/folder/archive sync; HubSpot ticket mining; site crawl.
- **Phase 2:** Stingray M365 (wire `GraphMailAdapter`), social/web channels, rules engine, analytics.
- **Phase 3:** factor the engine into a shared service for Birdseye + the portals.
```
