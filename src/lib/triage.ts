import Anthropic from "@anthropic-ai/sdk";

/**
 * Intake triage — separates real customer inquiries from inbox noise BEFORE
 * anything reaches a rep or costs a drafting call.
 *
 * Two stages, cheap-first:
 *   1. Deterministic rules (free): noreply senders, our own domains, obvious automation.
 *   2. Haiku classification (cheap) for everything else.
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

/** Cheap, fast model for classification — drafting stays on the main model. */
const TRIAGE_MODEL = "claude-haiku-4-5-20251001";

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

export function triageDeterministic(fromEmail: string, subject: string | null): TriageCategory | null {
  const email = fromEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (/^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|postmaster)@/.test(email))
    return "automated_notification";
  if (/(^|\.)(hubspot|shipstation|shopify|klaviyo|stripe|paypal|google|mailchimp)(mail|email|notifications?)?\.(com|net)$/.test(domain))
    return "automated_notification";
  if (domain === "rheosgear.com" || domain === "scribechs.com") return "internal";
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
      priority: { type: "string", enum: ["normal", "high"] },
    },
    required: ["category", "priority"],
  },
};

export async function triageLLM(
  fromEmail: string,
  subject: string | null,
  text: string
): Promise<{ category: TriageCategory; priority: "normal" | "high" }> {
  const res = await anthropic.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 128,
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "classify" },
    system:
      "You triage the support inbox of Rheos, a floating-sunglasses brand. " +
      "customer_inquiry = a real customer asking about products/warranty/shipping/fit. " +
      "order_issue = an upset or time-sensitive order problem (wrong address, missing order, damaged) — mark priority high. " +
      "ANY address-change request, fulfillment problem, or urgent-sounding ask is priority high — those race against shipment. " +
      "wholesale_inquiry = a shop/dealer asking about wholesale, bulk, or dealer terms. " +
      "vendor_outreach = someone selling THEIR service to Rheos (marketing agencies, SaaS pitches, recruiters, link builders). " +
      "automated_notification = machine-generated (receipts, platform alerts, voicemail transcriptions). " +
      "internal = Rheos/Scribe staff coordination. spam = junk.",
    messages: [
      {
        role: "user",
        content: `From: ${fromEmail}\nSubject: ${subject ?? "(none)"}\n\n${text.slice(0, 1500)}`,
      },
    ],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use")
    return { category: "customer_inquiry", priority: "normal" }; // fail open — a rep sees it
  return call.input as { category: TriageCategory; priority: "normal" | "high" };
}

export async function triage(
  fromEmail: string,
  subject: string | null,
  text: string
): Promise<{ category: TriageCategory; priority: "normal" | "high"; isNoise: boolean }> {
  const det = triageDeterministic(fromEmail, subject);
  const result = det ? { category: det, priority: "normal" as const } : await triageLLM(fromEmail, subject, text);
  const isNoise = NOISE_CATEGORIES.includes(result.category);
  // Deterministic urgency floor — applies to real inquiries regardless of what
  // the model said (never elevates noise).
  const priority = !isNoise && urgencyDeterministic(subject, text) ? "high" : result.priority;
  return { ...result, priority, isNoise };
}
