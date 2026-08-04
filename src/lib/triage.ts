import Anthropic from "@anthropic-ai/sdk";

/**
 * Intake triage — separates real customer inquiries from inbox noise BEFORE
 * anything reaches a rep or costs a drafting call, and classifies real
 * inquiries into the fine-grained category that drives routing (auto-assign
 * to a specialist), brain training, and analytics.
 *
 * Two stages, cheap-first:
 *   1. Deterministic rules (free): noreply senders, our own domains, obvious automation.
 *   2. Sonnet classification for everything else — routing now carries assignment
 *      consequences, so this stepped up from Haiku (client-paid quality bar).
 *
 * Noise is auto-archived with its category as a tag — never deleted, just out
 * of the working queue. Only real inquiries get auto-drafted.
 */

export type TriageCategory =
  | "customer_inquiry"
  | "order_issue"
  | "wholesale_inquiry"
  | "automated_notification"
  | "vendor_outreach"
  | "internal"
  | "spam";

export const NOISE_CATEGORIES: TriageCategory[] = [
  "automated_notification",
  "vendor_outreach",
  "internal",
  "spam",
];

import { INQUIRY_CATEGORIES, type InquiryCategory } from "./categories";
export { INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, type InquiryCategory } from "./categories";
import { PRIORITIES, type Priority } from "./priority";

/** Per-tenant triage context — what the classifier needs to know about the brand. */
export type BrandContext = {
  name: string;
  blurb: string; // one line: what the company sells
  internalDomains: string[]; // staff mail = "internal" noise
};

const BRAND_CONTEXTS: Record<string, BrandContext> = {
  rheos: {
    name: "Rheos",
    blurb: "a floating-sunglasses brand (polarized eyewear that floats)",
    internalDomains: ["rheosgear.com", "scribechs.com"],
  },
  stingray: {
    name: "Stingray Boats",
    blurb: "a powerboat manufacturer (boats sold through a dealer network)",
    internalDomains: ["stingrayboats.com", "scribechs.com"],
  },
};

export function brandContextFor(slug: string): BrandContext {
  return BRAND_CONTEXTS[slug] ?? { name: slug, blurb: "a consumer brand", internalDomains: ["scribechs.com"] };
}

/**
 * Classification model. Sonnet 5 defaults to ADAPTIVE THINKING ON — with a
 * forced tool choice and a small max_tokens budget, thinking must stay
 * disabled or it eats the budget before the tool output (see the 2026-07-04
 * detect-learning handoff for the same trap).
 */
const TRIAGE_MODEL = "claude-sonnet-5";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Deterministic urgency — Jake's rule: address changes, fulfillment problems,
 * and urgent-sounding asks go straight to the top, model or no model. These
 * race against shipment, so a false positive is cheaper than a miss.
 */
export function urgencyDeterministic(subject: string | null, text: string): boolean {
  const hay = `${subject ?? ""}\n${text}`.slice(0, 2000);
  return /(change|update|fix|wrong|incorrect|edit)[^.\n]{0,40}(shipping\s+)?address|address\s+(change|update|correction)|cancel\s+(my\s+|this\s+)?order|change\s+my\s+order|before\s+it\s+ships|hasn'?t\s+(shipped|arrived)|never\s+(arrived|received|got)|wrong\s+(item|size|order)|missing\s+(item|order|package)|\burgent\b|\basap\b|right\s+away|immediately/i.test(
    hay
  );
}

export function triageDeterministic(
  fromEmail: string,
  subject: string | null,
  brand: BrandContext
): TriageCategory | null {
  const email = fromEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (/^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster)@/.test(email))
    return "automated_notification";
  if (/(^|\.)(hubspot|shipstation|shopify|klaviyo|stripe|paypal|google|mailchimp|facebook|proofpoint(essentials)?)(mail|email|notifications?)?\.(com|net)$/.test(domain))
    return "automated_notification";
  if (brand.internalDomains.includes(domain)) return "internal";
  if (subject && /^(fwd:\s*new voicemail|out of office|automatic reply|delivery status)/i.test(subject))
    return "automated_notification";
  return null;
}

const TRIAGE_TOOL = {
  name: "classify",
  description: "Classify the inbound email.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: [
          "customer_inquiry",
          "order_issue",
          "wholesale_inquiry",
          "automated_notification",
          "vendor_outreach",
          "internal",
          "spam",
        ],
      },
      inquiryCategory: {
        type: "string",
        enum: [...INQUIRY_CATEGORIES],
        description:
          "For real inquiries only (customer_inquiry / order_issue / wholesale_inquiry): the specific topic. Omit for noise.",
      },
      priority: { type: "string", enum: [...PRIORITIES] },
    },
    required: ["category", "priority"],
  },
};

export type TriageResult = {
  category: TriageCategory;
  inquiryCategory: InquiryCategory | null;
  priority: Priority;
  isNoise: boolean;
};

export async function triageLLM(
  fromEmail: string,
  subject: string | null,
  text: string,
  brand: BrandContext
): Promise<{ category: TriageCategory; inquiryCategory: InquiryCategory | null; priority: Priority }> {
  const res = await anthropic.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 256,
    thinking: { type: "disabled" },
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "classify" },
    system:
      `You triage the support inbox of ${brand.name}, ${brand.blurb}. ` +
      "customer_inquiry = a real customer asking about products/warranty/shipping/fit. " +
      "order_issue = an upset or time-sensitive order problem (wrong address, missing order, damaged). " +
      "Priority is a four-level scale — most mail is normal: " +
      "urgent = racing the clock: address changes, cancel-before-ship, wrong/missing orders, explicit ASAP. " +
      "high = time-sensitive or an upset customer, but nothing is racing a shipment. " +
      "medium = a real question worth answering soon (availability, parts, sizing before an order). " +
      "normal = everything else. A parts-availability or general product question with no deadline is NEVER urgent. " +
      `wholesale_inquiry = a shop/dealer asking about wholesale, bulk, or dealer terms. ` +
      `vendor_outreach = someone selling THEIR service to ${brand.name} (marketing agencies, SaaS pitches, recruiters, link builders). ` +
      "automated_notification = machine-generated (receipts, platform alerts, voicemail transcriptions). " +
      `internal = ${brand.name}/Scribe staff coordination. spam = junk.\n` +
      "For every real inquiry ALSO set inquiryCategory — the routing topic:\n" +
      "warranty = damaged/defective product, warranty claims. " +
      "replacement_parts = requests for a specific part or component. " +
      "shipping_order_status = where is my order, tracking, delivery, billing/charge status. " +
      "returns_exchange = wants to return or swap an order. " +
      "sizing_fit = which size/model fits. " +
      "product_question = pre-purchase questions, features, availability, recommendations. " +
      "wholesale = dealer/retailer/bulk/B2B accounts, dealer warranty or service on behalf of their customer. " +
      "marketing_collab = sponsorships, brand partnerships, ambassadors, social-media collabs (a REAL inbound opportunity, not a cold pitch selling services). " +
      `purchasing_po = an EXISTING supplier or manufacturer corresponding about ${brand.name}'s own purchase orders, production, or inbound inventory — this is real business mail, never vendor_outreach. ` +
      "escalation = demands a manager/owner, asks for an exception outside normal policy, legal threats, or special-circumstance approvals. " +
      "other = a real inquiry that fits none of the above.",
    messages: [
      {
        role: "user",
        content: `From: ${fromEmail}\nSubject: ${subject ?? "(none)"}\n\n${text.slice(0, 1500)}`,
      },
    ],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use")
    return { category: "customer_inquiry", inquiryCategory: "other", priority: "normal" }; // fail open — a rep sees it
  const input = call.input as {
    category: TriageCategory;
    inquiryCategory?: string;
    priority: string;
  };
  // Tool enums are not server-enforced — guard against out-of-set values.
  const inquiryCategory = (INQUIRY_CATEGORIES as readonly string[]).includes(input.inquiryCategory ?? "")
    ? (input.inquiryCategory as InquiryCategory)
    : null;
  const priority = (PRIORITIES as readonly string[]).includes(input.priority)
    ? (input.priority as Priority)
    : "normal";
  return { category: input.category, inquiryCategory, priority };
}

export async function triage(
  fromEmail: string,
  subject: string | null,
  text: string,
  brand: BrandContext = BRAND_CONTEXTS.rheos
): Promise<TriageResult> {
  const det = triageDeterministic(fromEmail, subject, brand);
  const result = det
    ? { category: det, inquiryCategory: null, priority: "normal" as const }
    : await triageLLM(fromEmail, subject, text, brand);
  const isNoise = NOISE_CATEGORIES.includes(result.category);
  // Deterministic urgency floor — applies to real inquiries regardless of what
  // the model said (never elevates noise).
  const priority = !isNoise && urgencyDeterministic(subject, text) ? "urgent" : result.priority;
  const inquiryCategory = isNoise ? null : (result.inquiryCategory ?? "other");
  return { category: result.category, inquiryCategory, priority, isNoise };
}
