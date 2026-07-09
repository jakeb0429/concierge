import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { retrieve } from "@/lib/brain/retrieval";
import { getCurrentTenant } from "@/lib/tenant";
import { findStockists, stockistLines } from "@/lib/stockists";
import { extractProductMention } from "@/lib/product-extract";
import { parseBody } from "@/lib/validate";

/**
 * Internal assist chatbot — answers a rep's question from the Brand Brain
 * PLUS live data tools. Internal reference only, never customer-facing.
 *
 * Tools give it real lookups instead of "I can't do that":
 *   find_stockists — which retail accounts bought a product, where, when
 *                    (HubSpot won-deal line items, synced nightly).
 * Body: { question: string }
 */

const bodySchema = z.object({ question: z.string().trim().min(1) });

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_stockists",
    description:
      "Look up which retail/wholesale accounts recently ordered our products — answers 'which store (near X) carries product Y'. Returns account name, city/state, last wholesale order date, units. This is what stores ORDERED, not live shelf stock.",
    input_schema: {
      type: "object" as const,
      properties: {
        product: { type: "string", description: "Product or silhouette name, e.g. 'Mutiny'. Omit for all products." },
        place: { type: "string", description: "City, state (e.g. 'Charleston' or 'SC'), or zip prefix. Omit for anywhere." },
        months: { type: "number", description: "Lookback window in months (default 12)." },
      },
    },
  },
];

export async function POST(req: Request) {
  const parsed = await parseBody(req, bodySchema);
  if (parsed instanceof NextResponse) return parsed;
  const { question } = parsed;
  const tenant = await getCurrentTenant();
  const items = await retrieve(tenant.id, question);
  const grounding = items.length
    ? items.map((i) => `[${i.title}] ${i.answer}`).join("\n\n")
    : "(no matching Brand Brain entries)";

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Question from the rep: ${question}\n\nBrand Brain context:\n${grounding}` },
  ];
  let usedTools = false;

  // Agentic loop — up to 3 tool rounds, then the model must answer.
  for (let round = 0; round < 4; round++) {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 700,
      tools: TOOLS,
      system:
        "You help a customer-service rep at " +
        tenant.name +
        ". Answer from the Brand Brain context and your tools — never invent facts. " +
        "For 'which store carries / recently ordered X' questions, USE find_stockists. " +
        "When you report stockist data, be clear it reflects wholesale orders (what stores bought from us), " +
        "not live shelf inventory — recent orders are the best signal a store has it. " +
        "Be concise and practical; give the rep something they can act on or paste from.",
      messages,
    });

    const toolCalls = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (toolCalls.length === 0 || round === 3) {
      const answer = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
      return NextResponse.json({
        answer,
        sources: [
          ...items.map((i) => ({ id: i.id, title: i.title })),
          ...(usedTools ? [{ id: "hubspot-stockists", title: "Wholesale orders (HubSpot, nightly sync)" }] : []),
        ],
      });
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      usedTools = true;
      const input = call.input as { product?: string; place?: string; months?: number };
      // Normalize free text ("mutiny sunglasses") onto a canonical family.
      const family = input.product ? (await extractProductMention(input.product)).productFamily : null;
      const hits = await findStockists({
        tenantId: tenant.id,
        productFamily: family,
        place: input.place ?? null,
        months: input.months ?? 12,
        limit: 8,
      });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: hits.length
          ? `${hits.length} account(s)${family ? ` for ${family}` : ""}${input.place ? ` near "${input.place}"` : ""}:\n` +
            stockistLines(hits, family).join("\n")
          : `No wholesale orders found${family ? ` for ${family}` : ""}${input.place ? ` near "${input.place}"` : ""} in the window. (If a product name didn't match, try without it or check the spelling.)`,
      });
    }
    messages.push({ role: "user", content: results });
  }
  return NextResponse.json({ answer: "Something went wrong — try again.", sources: [] });
}
