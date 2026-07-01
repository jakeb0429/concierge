# Concierge — Your Setup Checklist

> The short list of things only you can do. Everything else is built and running.
> Updated 2026-07-01. Repo: github.com/jakeb0429/concierge · App port 3014 on birdseye.

---

## 1. DNS record — ✅ DONE (2026-07-01)

A record added, certbot issued the certificate, and **https://concierge.scribechs.com
is live** (HTTP redirects to HTTPS; cert auto-renews). A sign-in email was sent to
jacob.berton@gmail.com — check your inbox to log in.

---

## 2. Voyage AI key — ✅ DONE (2026-07-01)

All 81 Brand Brain entries embedded; semantic retrieval verified live
("my shades got scraped up at the beach" → Saltwater Promise, zero keyword overlap).

**One small follow-up:** the Voyage account has no payment method, so it runs at
reduced rate limits (3 requests/min). Fine for current volume, but add a card at
https://dashboard.voyageai.com → Billing when convenient — the 200M free tokens
still apply, so cost stays ~$0; it just lifts the throttle.

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
| Triage, scheduled intake (every 10 min), learning detector, deploy | ✅ live on birdseye |
| Public URL + SSL | ✅ https://concierge.scribechs.com live (2026-07-01) |
| Semantic search | ✅ live, 81 entries embedded (2026-07-01) |
