import { describe, expect, it } from "vitest";
import { POST, GET } from "@/app/view/[mode]/route";

// The view toggle: POST sets the preference cookie and redirects to the
// matching home; GET (a signed-out toggle replayed through /login) redirects
// WITHOUT touching the cookie — a prefetched GET must never flip the view.
// Redirect targets build on baseUrl(req), never req.url (nginx says localhost).

// A bare Request carries no Host header — set it so baseUrl resolves the
// local origin instead of falling back to the canonical production URL.
const req = (method: string) =>
  new Request("http://localhost:3014/view/simple", { method, headers: { host: "localhost:3014" } });
const params = (mode: string) => ({ params: Promise.resolve({ mode }) });

describe("/view/[mode]", () => {
  it("POST simple sets the cookie and lands on the questions queue", async () => {
    const res = await POST(req("POST"), params("simple"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3014/questions");
    expect(res.headers.get("set-cookie")).toContain("concierge-view=simple");
  });

  it("POST full sets the cookie and lands on the inbox", async () => {
    const res = await POST(req("POST"), params("full"));
    expect(res.headers.get("location")).toBe("http://localhost:3014/");
    expect(res.headers.get("set-cookie")).toContain("concierge-view=full");
  });

  it("rejects an unknown mode with 400", async () => {
    const res = await POST(req("POST"), params("admin"));
    expect(res.status).toBe(400);
  });

  it("GET redirects without setting the cookie", async () => {
    const res = await GET(req("GET"), params("simple"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3014/questions");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
