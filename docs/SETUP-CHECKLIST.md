# Concierge — Your Setup Checklist

> The short list of things only you can do. Everything else is built and running.
> Updated 2026-07-01. Repo: github.com/jakeb0429/concierge · App port 3014 on birdseye.

---

## 1. DNS record — unblocks the public URL 🔴 (2 minutes)

The app is deployed on the birdseye server, but `concierge.scribechs.com` doesn't
resolve yet, so there's no public HTTPS access.

1. Open the DNS manager for **scribechs.com** (wherever clients./firstdraft./justforfun. are managed — likely the registrar or Cloudflare).
2. Add an **A record**:
   - **Name / host:** `concierge`
   - **Value:** `72.61.177.29`
   - **TTL:** default is fine
3. Tell Claude "DNS is in" — the SSL certificate (certbot) and final URL check take one command from there.

**Done when:** `https://concierge.scribechs.com` loads the login page.

---

## 2. Voyage AI key — turns on semantic search 🟡 (10 minutes)

Everything currently retrieves via keyword matching. The Voyage key activates the
semantic index so questions like "which frames fit a narrow face?" find the right
product entries even with zero keyword overlap.

1. Go to **https://www.voyageai.com** → sign up (Google login works).
2. Dashboard → **API Keys** → **Create new key** (name it `concierge`).
3. Send Claude the key (starts with `pa-…`).

Claude then adds it to the env and runs the already-built backfill
(`npm run db:embed`) — all 81+ Brand Brain entries get embedded, and every new
entry embeds automatically from then on.

**Cost note:** Voyage has a generous free tier; this workload is tiny (a few
hundred embeddings + one per new knowledge entry / draft query).

**Done when:** drafts cite product entries for paraphrased questions.

---

## 3. Approve the mined FAQ candidates 🟡 (5 minutes, in the app)

Three FAQ candidates mined from real hello@ history are waiting at
**Brand Brain** (top of the list, "pending approval"):

- What's your smallest frame for women / a tighter fit?
- My glasses broke — how do I get a replacement, and what does it cost?
- Can I get a replacement arm for my sunglasses?

Read each answer (they were synthesized from real rep replies — check the $
amounts and policy details), **Edit** if anything's off, then **Approve**.
Approved entries immediately start grounding drafts.

---

## 4. Decide the go-live posture for live send 🟢 (just a decision)

Live send is **enabled** (`CONCIERGE_LIVE_SEND=true`): clicking
**Confirm and send** on a real ticket transmits a real email from
hello@ / wholesale@. Safeties in place:

- The recipient is shown on the button itself ("Confirm and send → x@y.com").
- Mock/test tickets can never transmit.
- Nothing ever sends without a human clicking confirm.

If you'd rather soft-launch (log instead of send) while the team gets used to
it, tell Claude to flip it back — it's one env var.

---

## 5. Optional / later

| Item | Why | Effort |
|---|---|---|
| Rotate the **Rheos Shopify admin token** | The one in rheos-inventory/.env returns 401 — that app's syncs may be limping. Not needed by Concierge. | Shopify admin → Apps → regenerate |
| **AUTH_ALLOWLIST** additions | Currently jacob.berton@gmail.com, jake@scribechs.com, hello@rheosgear.com. Add reps' emails when they onboard. | Tell Claude |
| **Stingray / Microsoft 365** onboarding | The Graph adapter is scaffolded; needs an Azure app registration when Stingray is ready. | ~30 min in Azure portal, Claude guides |
| **claude-opus-4-8 → newer model** | Model id is centralized in `src/lib/anthropic.ts`; one-line change whenever. | — |

---

## Where everything stands (for reference)

| Piece | Status |
|---|---|
| Core loop (inbox → draft → steer → confirm/send) | ✅ live, verified on real hello@ mail |
| Gmail hello@ + wholesale@ | ✅ live intake; live send ON with recipient display |
| Brand Brain (81 entries: brand docs, mined FAQ, 69 product families, inventory snapshot) | ✅ |
| Magic-link auth + allowlist | ✅ |
| Triage (noise vs customer), scheduled intake, learning detector, deploy | 🔨 Claude executing now |
| Public URL + SSL | ⬜ blocked on **your DNS record (item 1)** |
| Semantic search | ⬜ blocked on **your Voyage key (item 2)** |
