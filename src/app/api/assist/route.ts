import { NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";
import { retrieve } from "@/lib/brain/retrieval";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Internal assist chatbot — answers a rep's question from the Brand Brain, with
 * sources. Internal reference only, never customer-facing. Same index as the drafts.
 * Body: { question: string }
 */
export async function POST(req: Request) {
  const { question } = (await req.json()) as { question: string };
  const tenant = await getCurrentTenant();
  const items = await retrieve(tenant.id, question);

  if (!items.length) {
    return NextResponse.json({
      answer: "I don't have anything in the Brand Brain on that yet — worth adding an entry.",
      sources: [],
    });
  }

  const grounding = items.map((i) => `[${i.title}] ${i.answer}`).join("\n\n");
  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 512,
    system:
      "You help a customer-service rep by answering from the provided Brand Brain only. " +
      "Be concise and practical. If the knowledge doesn't cover it, say so plainly.",
    messages: [{ role: "user", content: `Question: ${question}\n\nBrand Brain:\n${grounding}` }],
  });

  const answer = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
  return NextResponse.json({
    answer,
    sources: items.map((i) => ({ id: i.id, title: i.title })),
  });
}
