/**
 * HubSpot fetch with the hard-won reliability rules baked in:
 * 30s socket timeout (hung sockets stalled whole backfills), 429 backoff,
 * bounded retries. Every script and route goes through this.
 */
export async function hubspot<T>(path: string, attempt = 0): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => {
    if (attempt >= 6) throw e;
    return null;
  });
  if (!res) {
    await new Promise((r) => setTimeout(r, 3_000));
    return hubspot(path, attempt + 1);
  }
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 11_000));
    return hubspot(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

/** Best-effort variant: returns null instead of throwing (per-item loops). */
export async function hubspotOrNull<T>(path: string): Promise<T | null> {
  try {
    return await hubspot<T>(path);
  } catch {
    return null;
  }
}
