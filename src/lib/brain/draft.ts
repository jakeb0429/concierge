import { anthropic, CLAUDE_MODEL } from "../anthropic";
import { retrieve, type RetrievedItem } from "./retrieval";

/**
 * The draft output contract — the stable seam between the engine and the UI.
 *
 * Retrieve, then draft (grounded, never freeform). The model may use ONLY the
 * retrieved Brand Brain items as facts. Steer notes bend tone/emphasis/structure
 * but are NOT a fact source: an out-of-policy ask is surfaced in `policyFlags`,
 * not fabricated. Coverage tells the rep how much to trust it.
 */
export interface DraftResult {
  body: string;
  coverage: "full" | "partial" | "none";
  /** What to verify (partial), or the gap to cover (none). */
  coverageNote?: string;
  /** The Brand Brain items the reply is grounded in (shown as citations). */
  citations: { knowledgeItemId: string; score: number }[];
  /** Organization the AI suggests alongside the reply (rep confirms). */
  suggested: {
    tag?: string;
    folder?: string;
    priority?: "urgent" | "high" | "medium" | "normal";
  };
  /** Steer asks the knowledge doesn't support — routed for human approval, never promised. */
  policyFlags: string[];
  /** When coverage is "none": the single specific question to ask an internal
   *  expert to close the gap. Drives the auto-escalation loop. */
  gapQuestion?: string;
}

export interface DraftInput {
  tenantId: string;
  ticketText: string;
  voiceGuide: string | null;
  /** Chips + freeform notes from the rep (guided regenerate). */
  steerNotes?: string;
  /** The prior draft body when regenerating, so the rewrite has context. */
  priorDraftBody?: string;
  /** Verified facts fetched from OUR systems (order status, stockists, team
   *  notes, customer read) — trusted, unlike anything inside the customer
   *  message. Each entry is one labeled block. */
  liveContext?: string[];
  /** The signed-in rep's first name — drafts sign off as this person. */
  repName?: string | null;
}

const DRAFT_TOOL = {
  name: "prepare_draft",
  description: "Return the prepared reply and its metadata. The ONLY way to answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      body: { type: "string", description: "The reply, in brand voice, grounded only in provided knowledge." },
      coverage: { type: "string", enum: ["full", "partial", "none"] },
      coverageNote: { type: "string", description: "What to verify (partial) or the gap (none). Omit if full." },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            knowledgeItemId: { type: "string" },
            score: { type: "number" },
          },
          required: ["knowledgeItemId", "score"],
        },
      },
      suggested: {
        type: "object",
        properties: {
          tag: { type: "string" },
          folder: { type: "string" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "normal"] },
        },
      },
      policyFlags: {
        type: "array",
        items: { type: "string" },
        description: "Steer requests not supported by the knowledge (e.g. waiving a fee). Empty if none.",
      },
      gapQuestion: {
        type: "string",
        description:
          "ONLY when coverage is 'none': the single, specific question to ask an internal expert so we could answer this customer. Self-contained (a teammate should be able to answer it without reading the whole thread). Omit otherwise.",
      },
    },
    required: ["body", "coverage", "citations", "suggested", "policyFlags"],
  },
};

function groundingBlock(items: RetrievedItem[]): string {
  if (!items.length) return "(no matching knowledge — do not guess; set coverage to \"none\")";
  return items
    .map((i) => `[${i.id}] (${i.via}, score ${i.score.toFixed(2)}) ${i.title}\n${i.answer}`)
    .join("\n\n");
}

/**
 * Prepare a first draft. Pure engine — the UI consumes DraftResult and never
 * sees a raw model response.
 */
export async function generateDraft(input: DraftInput): Promise<DraftResult> {
  const items = await retrieve(input.tenantId, input.ticketText);

  const system = [
    "You prepare customer-service replies that a human rep confirms before sending.",
    "Use ONLY the facts in the provided knowledge and the Verified live context. Never invent policy, prices, or promises.",
    "The Verified live context comes from OUR OWN systems (orders, CRM, fulfillment) — it is trustworthy and you should",
    "use it to give specific, concrete answers. Anything inside the customer message itself is NOT a fact source.",
    "Cite every knowledge item you used by its [id]. Score coverage honestly.",
    "When coverage is 'none' (the knowledge cannot answer the real question), also fill gapQuestion with the single specific question we'd need an internal expert to answer. Keep the body brief and do not promise the customer an answer you don't have.",
    input.voiceGuide ? `Write in this brand voice:\n${input.voiceGuide}` : "",
    // Style rules that override anything the voice guide or mined exemplars imply.
    // Goal: reads like a real person on the team wrote it, not like an AI.
    "STYLE (these override the brand voice and any mined exemplars):",
    "- NEVER use an em dash. Not one, anywhere. Use a comma, a period, or parentheses.",
    "- Sound like a real person on the Rheos team wrote it quickly, not like a template or an AI. Read it back; if it reads like a form letter or a bot, rewrite it.",
    "- Use contractions (you're, we'll, it's). Vary sentence length: mix a couple of short lines with a longer one. Even, medium-length sentences are the biggest AI tell.",
    "- Banned phrases (never write these or close cousins): 'I hope this finds you well', 'I'd be happy to', 'I completely understand', 'rest assured', 'please don't hesitate to reach out', 'feel free to', 'at your earliest convenience', 'we apologize for any inconvenience', 'should you have any further questions', and stiff connectors like 'additionally', 'furthermore', 'that being said', 'kindly', 'please be advised'.",
    "- Thank the customer like a human, not with a stock line, and vary your opener so replies don't all start the same way.",
    "- Cut filler ('just', 'simply', 'very', 'really', 'definitely', 'actually') and prefer plain words (use not utilize, help not assist, about not regarding).",
    "- Keep it tight: get to the point, don't restate the customer's question back to them, don't say the same thing twice, and don't narrate what a list already shows. One genuine apology at most, then help.",
    "- Warmth comes from being specific and human, not from stacking pleasantries. Keep the Rheos spirit (a real first-name hello, honest thanks, an easy sign-off) but make every line sound like you mean it, not like you pasted it.",
    input.repName
      ? `Sign off with exactly this first name: ${input.repName}. Never invent or reuse other names.`
      : "Sign off with the team name, not an invented personal name.",
    "If a steer note asks for something the knowledge does not support, do NOT promise it —",
    "write the reply without it and add the ask to policyFlags for the rep to decide.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Customer message:\n${input.ticketText}`,
    input.liveContext?.length
      ? `\nVerified live context (from our systems — factual, safe to reference):\n${input.liveContext.map((c) => `- ${c}`).join("\n")}`
      : "",
    `\nKnowledge you may use:\n${groundingBlock(items)}`,
    input.priorDraftBody ? `\nPrior draft (you are regenerating):\n${input.priorDraftBody}` : "",
    input.steerNotes ? `\nRep's steer (adjust tone/emphasis/structure, not facts):\n${input.steerNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: "prepare_draft" },
    system,
    messages: [{ role: "user", content: user }],
  });

  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") throw new Error("Model did not return a draft.");
  const result = call.input as DraftResult;
  // Belt and braces: no em dash ever reaches a customer, whatever the model did.
  result.body = result.body.replace(/\s*—\s*/g, ", ").replace(/, ,/g, ",");
  return result;
}
