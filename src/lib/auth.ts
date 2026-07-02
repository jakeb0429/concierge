import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "./db";

/**
 * Magic-link tokens are stored hashed — the raw token only ever lives in the link.
 * Web Crypto (not node:crypto): this module is bundled into the Edge middleware,
 * where node builtins are a hard error.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Password hashing — PBKDF2 via Web Crypto (Edge-safe, no deps), stored as
 * "pbkdf2$<iterations>$<saltB64>$<hashB64>". Passwords are a convenience for
 * saved-credential logins; magic-link remains the default path.
 */
const PBKDF2_ITER = 210_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await pbkdf2(password, new Uint8Array(Buffer.from(saltB64, "base64")), Number(iterStr));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i]; // constant-time
  return diff === 0;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "magic-link",
      credentials: { email: {}, token: {} },
      async authorize(credentials) {
        const email = (credentials?.email as string)?.toLowerCase().trim();
        const token = credentials?.token as string;
        if (!email || !token) return null;

        const user = await prisma.user.findFirst({
          where: {
            email,
            magicLinkToken: await hashToken(token),
            magicLinkExpires: { gt: new Date() },
          },
        });
        if (!user) return null;

        // One-time use: consume the token, stamp the login.
        await prisma.user.update({
          where: { id: user.id },
          data: { magicLinkToken: null, magicLinkExpires: null, lastLogin: new Date() },
        });
        return { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role };
      },
    }),
    Credentials({
      id: "password",
      name: "password",
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = (credentials?.email as string)?.toLowerCase().trim();
        const password = credentials?.password as string;
        if (!email || !password) return null;

        // Having a passwordHash on the account IS the grant — set via
        // prisma/set-password.ts, never self-service.
        const user = await prisma.user.findFirst({ where: { email, passwordHash: { not: null } } });
        if (!user || !(await verifyPassword(password, user.passwordHash!))) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        return { id: user.id, email: user.email, name: user.name, tenantId: user.tenantId, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = (user as { tenantId?: string }).tenantId;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  trustHost: true,
});
