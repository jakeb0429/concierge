/**
 * Rheos Brand Brain seed — distilled from the source docs:
 *   - Rheos Messaging Framework 2025 (voice, product facts, warranty/returns)
 *   - Brand Guidelines Fall 2024 (voice & tone, characteristics)
 *   - Rheos Overview 2025
 *
 * This is the day-one FAQ so the flywheel starts spun, not empty. Historical
 * hello@ tickets (mined from HubSpot) layer real Q&A candidates on top of this.
 * Everything here ships status:"approved" because it comes straight from approved
 * brand collateral.
 */

export const RHEOS_VOICE_GUIDE = `Rheos voice — "Built for the love of water."

Tone: upbeat and optimistic (but never naïve or ignorantly positive). Approachable
and relatable — never exclusive, elite, or extreme, and NEVER too technical.
Conversational, like chatting over beers ("Cheers!"). Grounded in what matters,
passionate but lighthearted. Good-humored, never cheesy or hokey.

Characteristics: Spirited, Inviting, Purposeful.
We are thrill seekers and sun soakers; beach loungers and boat launchers.
Make people feel good, feel inspired, feel like one of us.`;

interface SeedItem {
  kind: "faq" | "policy" | "product" | "script";
  title: string;
  answer: string;
  triggerPhrases: string[];
  tags: string[];
  category: string;
  sourceRef: string;
}

export const RHEOS_SEED: SeedItem[] = [
  {
    kind: "policy",
    title: "Saltwater Promise — lens replacement",
    answer:
      "Every pair of Rheos shades is backed by our 1-year Saltwater Promise. If your " +
      "lenses have an issue within the first year, we'll replace them — we just ask you " +
      "cover a flat $20 warranty replacement fee to handle shipping anywhere in the U.S. " +
      "Our lenses are rated for 120 hours of continuous saltwater exposure, 5x longer than " +
      "standard polycarbonate.",
    triggerPhrases: ["warranty", "lens replacement", "saltwater promise", "scratched lenses", "replace lenses"],
    tags: ["warranty", "policy", "lenses"],
    category: "Warranty",
    sourceRef: "Messaging Framework 2025 — Saltwater Promise",
  },
  {
    kind: "policy",
    title: "Warranty coverage — frames, claims, and how we practice it",
    answer:
      "OFFICIAL POLICY (rheosgear.com/pages/warranty): every pair carries a 1-year warranty. " +
      "Frames: manufacturer defects for one year (non-accidental damage), one claim per pair, " +
      "photo evidence required. Lenses: the Saltwater Promise covers manufacturer-related lens " +
      "issues for one year, including saltwater and humidity exposure (rated for 120 hours of " +
      "continuous saltwater exposure, the industry's highest rating). A $20 processing and " +
      "shipping fee may apply within the US (international varies); replacement is free when the " +
      "purchase is within 30 days. To file a claim: email a photo of the damage plus order info " +
      "to hello@rheosgear.com.\n\n" +
      "HOW WE PRACTICE IT (lean generous; verify the purchase first by receipt or an order " +
      "lookup on their email):\n" +
      "- Within 30 days of purchase: replace free of charge.\n" +
      "- Within the year: replacement with the $20 fee, collected via a custom emailed invoice.\n" +
      "- Replacement arms and parts: when the part is in stock we often ship it free; when the " +
      "part is no longer available we offer a discounted replacement pair at a $10 fee instead " +
      "of $20.\n" +
      "- Style out of stock: offer the closest current alternatives, or note the restock timing " +
      "and follow up when it lands.\n" +
      "- Outside 12 months or no proof of purchase: offer a goodwill 30% discount on a new pair " +
      "as a valued member, and confirm they want to proceed before acting.\n" +
      "- Sun Collective VIP members ($5/month): 2-year warranty including limited accidental " +
      "damage, $5 flat-rate repairs or replacements, and 30% off the Oops Replacement Program " +
      "for same-SKU replacements.",
    triggerPhrases: [
      "warranty", "broken", "frame broke", "arm broke", "snapped", "defect", "defective",
      "repair", "replacement part", "replacement arm", "broken part", "fix my sunglasses",
    ],
    tags: ["warranty", "policy", "frames", "repairs", "practice"],
    category: "Warranty",
    sourceRef: "rheosgear.com/pages/warranty + hello@ sent-mail audit 2026-07-09",
  },
  {
    kind: "policy",
    title: "Returns & exchanges — policy and how we practice it",
    answer:
      "OFFICIAL POLICY (rheosgear.com/policies/refund-policy — the standard we fall back on): " +
      "returns are accepted within 30 days of delivery for items that are unused, in original " +
      "condition and packaging. The customer starts a return by emailing hello@rheosgear.com; " +
      "once approved we email a return label and instructions (label pricing can vary for " +
      "international and non-continental US). Refunds go to the original payment method and " +
      "process within 10 days of approval. Items damaged or missing parts for reasons not due " +
      "to our error are not guaranteed a refund.\n\n" +
      "HOW WE PRACTICE IT (lean generous; we would rather keep a customer than enforce a " +
      "technicality):\n" +
      "- We send the return label ourselves, in a separate email with instructions.\n" +
      "- Exchanges are return-first: receiving the customer's return releases the exchange " +
      "shipment. When the case is clear and stock is on hand, reps may ship the exchange the " +
      "same day at their discretion.\n" +
      "- Defects or our error (wrong or missing item): free replacement or full refund, no fee; " +
      "we still set up a return for the defective pair.\n" +
      "- Refunds usually start within about 48 hours once approved.\n" +
      "- Discontinued colorway or style: invite the customer to pick a different current style.\n" +
      "- Purchased through a retailer or vendor: we cannot refund money for a purchase that was " +
      "not made with us, but in practice we offer a replacement pair (customer picks from " +
      "current styles) or direct them back to the retailer for a refund under that store's " +
      "policy. Amazon purchases refund through Amazon's own returns flow.\n" +
      "- Outside the 30-day window: if it is a product issue, fall back to the 1-year Saltwater " +
      "Promise warranty; otherwise a goodwill gesture such as 30% off a new pair is common " +
      "practice. Verify the purchase (order number or receipt) before promising a specific " +
      "resolution.",
    triggerPhrases: [
      "return", "exchange", "refund", "send back", "send them back", "money back", "swap",
      "wrong size", "too big", "too small", "return label", "not what I expected",
    ],
    tags: ["returns", "exchanges", "policy", "practice"],
    category: "Returns",
    sourceRef: "rheosgear.com/policies/refund-policy + hello@ sent-mail audit 2026-07-09",
  },
  {
    kind: "product",
    title: "Do Rheos sunglasses float?",
    answer:
      "Yes! Every pair of Rheos shades floats. The frames are made from a specialty " +
      "low-density polycarbonate that weighs 20–30% less than standard sunglasses, so if " +
      "they go overboard they'll float right back to the surface.",
    triggerPhrases: ["do they float", "floating", "float on water", "drop in water"],
    tags: ["product", "frames", "floating"],
    category: "Product",
    sourceRef: "Messaging Framework 2025 — Floatability",
  },
  {
    kind: "product",
    title: "Nylon lens clarity and durability",
    answer:
      "Our nylon lenses are lab-tested to be clearer than polycarbonate — clear as glass " +
      "(Abbe value of 52) — without the weight or shatter risk. They're impact-resistant, " +
      "hydrophobic (water beads right off), and have an integrated anti-scratch finish. " +
      "Note: we don't add anti-fog, since it isn't compatible with our oleophobic/hydrophobic coating.",
    triggerPhrases: ["nylon lenses", "lens clarity", "anti fog", "scratch resistant", "polarized"],
    tags: ["product", "lenses"],
    category: "Product",
    sourceRef: "Messaging Framework 2025 — Clear As Glass",
  },
  {
    kind: "product",
    title: "Comfort and fit",
    answer:
      "Because our frames are light enough to float, they're incredibly light on your face " +
      "too — no more tension headaches on long days outside. Embedded comfort-grip nose pieces " +
      "and temple grips keep them in place without pinching, and since the nose pieces are built " +
      "into the frame, they won't catch your hair when you push them up on your head.",
    triggerPhrases: ["comfortable", "fit", "nose pieces", "headache", "slipping"],
    tags: ["product", "comfort", "fit"],
    category: "Product",
    sourceRef: "Messaging Framework 2025 — Light as a Feather",
  },
  {
    kind: "policy",
    title: "Giving back — Land & Sea",
    answer:
      "Every Rheos purchase helps protect land and water for good. We partner with the " +
      "Lowcountry Land Trust to fund coastal conservation easements in South Carolina, and " +
      "support Charleston Waterkeeper and SCDNR. When we're not on a boat, you'll find us on " +
      "beach cleanups and turtle rehab around our home in Charleston.",
    triggerPhrases: ["giving back", "sustainability", "conservation", "charity", "donate"],
    tags: ["policy", "sustainability", "brand"],
    category: "Brand",
    sourceRef: "Messaging Framework 2025 — Protecting Land & Sea",
  },
  {
    kind: "faq",
    title: "Our story",
    answer:
      "Our story is the same as yours — we love life on the water. After losing one too many " +
      "pairs of expensive shades overboard, a husband-and-wife team in Charleston, S.C. set out " +
      "to fix it. We sold out of our first two floating styles in 2016, and Rheos has grown into " +
      "a full collection of high-performance eyewear built for the water. (Rheos is the Greek word " +
      "for river current.)",
    triggerPhrases: ["your story", "who are you", "about rheos", "founder"],
    tags: ["brand", "story"],
    category: "Brand",
    sourceRef: "Messaging Framework 2025 — Our Story",
  },
];
