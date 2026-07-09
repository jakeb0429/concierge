import { anthropic, CLAUDE_MODEL } from "../anthropic";

/**
 * Brand Brain ingestion — how the FAQ gets built (not hand-written).
 *
 * Three sources feed one pipeline that produces KnowledgeItem candidates
 * (status:"draft") for a lead to approve:
 *
 *   1. HubSpot hello@ tickets  -> real question→answer pairs. Cluster by semantic
 *      similarity to find recurring intents; synthesize one canonical answer per
 *      cluster from the best real replies. THIS is the gold — approved, real answers.
 *   2. rheosgear.com crawl     -> product/policy/FAQ pages chunked + embedded as
 *      reference KnowledgeItems.
 *   3. Brand docs              -> messaging framework + guidelines. Guidelines feed
 *      the tenant voiceGuide; framework/overview become reference.
 *
 * Each function is a skeleton so the flow, provenance (sourceRef), and human-approval
 * gate are correct before the source connectors are wired in Phase 1.
 */

export interface FaqCandidate {
  title: string;
  answer: string;
  triggerPhrases: string[];
  tags: string[];
  category: string;
  sourceRef: string;
  status: "draft"; // always human-approved before it grounds a customer reply
}

/** Mine closed hello@ conversations from HubSpot into FAQ candidates. */
export async function mineHubspotTickets(_tenantId: string): Promise<FaqCandidate[]> {
  // 1. Pull closed conversations (Birdseye already holds a HubSpot token).
  // 2. Extract (customer question, rep reply) pairs.
  // 3. Cluster by embedding similarity -> recurring intents.
  // 4. For each cluster, ask CLAUDE_MODEL to synthesize ONE canonical answer
  //    from the best real replies, in Rheos voice, citing the ticket ids.
  void anthropic;
  void CLAUDE_MODEL;
  void _tenantId;
  throw new Error("mineHubspotTickets() not wired — Phase 1: confirm HubSpot Conversations scope.");
}

/** Crawl rheosgear.com policy/FAQ/product pages into reference KnowledgeItems. */
export async function crawlWebsite(_tenantId: string, _startUrls: string[]): Promise<FaqCandidate[]> {
  void _tenantId;
  void _startUrls;
  throw new Error("crawlWebsite() not wired — Phase 1.");
}
