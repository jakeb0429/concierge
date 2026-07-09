import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Boundary validation (DEVELOPMENT-STANDARDS §2): every API route parses its
 * input against a zod schema before business logic. Returns typed data or a
 * ready-made 400 with field errors — no hand-rolled `if (!body.x)` chains.
 *
 *   const parsed = await parseBody(req, schema);
 *   if (parsed instanceof NextResponse) return parsed;
 *   const { field } = parsed; // typed
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<z.infer<T> | NextResponse> {
  const raw = await req.json().catch(() => null);
  const result = schema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  return result.data;
}

/** Same contract for query strings. */
export function parseQuery<T extends z.ZodTypeAny>(
  url: string,
  schema: T
): z.infer<T> | NextResponse {
  const params = Object.fromEntries(new URL(url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Invalid query.",
        fields: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  return result.data;
}
