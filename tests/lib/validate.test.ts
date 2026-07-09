import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, parseQuery } from "@/lib/validate";

const bodySchema = z.object({
  name: z.string().min(1),
  count: z.number().int().min(1),
});

function jsonRequest(body: string): Request {
  return new Request("http://test.local/api/thing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("parseBody", () => {
  it("returns typed data on valid input", async () => {
    const parsed = await parseBody(jsonRequest(JSON.stringify({ name: "widget", count: 3 })), bodySchema);
    expect(parsed).not.toBeInstanceOf(NextResponse);
    expect(parsed).toEqual({ name: "widget", count: 3 });
  });

  it("returns a 400 NextResponse with field errors on invalid input", async () => {
    const parsed = await parseBody(jsonRequest(JSON.stringify({ name: "", count: 0 })), bodySchema);
    expect(parsed).toBeInstanceOf(NextResponse);
    const res = parsed as NextResponse;
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; fields: { path: string; message: string }[] };
    expect(json.error).toBe("Invalid request.");
    expect(json.fields.map((f) => f.path)).toEqual(expect.arrayContaining(["name", "count"]));
    for (const field of json.fields) expect(typeof field.message).toBe("string");
  });

  it("returns a 400 on malformed JSON instead of throwing", async () => {
    const parsed = await parseBody(jsonRequest("{not valid json"), bodySchema);
    expect(parsed).toBeInstanceOf(NextResponse);
    expect((parsed as NextResponse).status).toBe(400);
  });
});

describe("parseQuery", () => {
  const querySchema = z.object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(1),
  });

  it("returns typed data on a valid query string", () => {
    const parsed = parseQuery("http://test.local/api/search?q=boots&limit=25", querySchema);
    expect(parsed).not.toBeInstanceOf(NextResponse);
    expect(parsed).toEqual({ q: "boots", limit: 25 });
  });

  it("returns a 400 NextResponse with field errors on an invalid query", async () => {
    const parsed = parseQuery("http://test.local/api/search?q=boots&limit=abc", querySchema);
    expect(parsed).toBeInstanceOf(NextResponse);
    const res = parsed as NextResponse;
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; fields: { path: string; message: string }[] };
    expect(json.error).toBe("Invalid query.");
    expect(json.fields.map((f) => f.path)).toContain("limit");
  });

  it("returns a 400 when a required param is missing", () => {
    const parsed = parseQuery("http://test.local/api/search?limit=5", querySchema);
    expect(parsed).toBeInstanceOf(NextResponse);
    expect((parsed as NextResponse).status).toBe(400);
  });
});
