import Anthropic from "@anthropic-ai/sdk";

/**
 * Centralized model id — the birdseye pattern. Next deprecation is a one-line change.
 */
export const CLAUDE_MODEL = "claude-opus-4-8";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
