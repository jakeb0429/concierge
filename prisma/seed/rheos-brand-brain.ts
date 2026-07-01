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
