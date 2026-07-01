import type { ChannelAdapter, ChannelConfig } from "./types";
import { GmailAdapter } from "./gmail";
import { GraphMailAdapter } from "./graph";

export * from "./types";

/**
 * The one place provider selection happens. The rest of Concierge asks for an
 * adapter by tenant config and never knows or cares which provider it got.
 *
 *   Rheos    -> provider "gmail" -> GmailAdapter
 *   Stingray -> provider "graph" -> GraphMailAdapter
 */
export function getChannelAdapter(cfg: ChannelConfig): ChannelAdapter {
  switch (cfg.provider) {
    case "gmail":
      return new GmailAdapter(cfg);
    case "graph":
      return new GraphMailAdapter(cfg);
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`Unknown channel provider: ${_exhaustive}`);
    }
  }
}
