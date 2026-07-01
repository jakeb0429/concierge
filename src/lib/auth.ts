import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createHash } from "crypto";
import { prisma } from "./db";

/** Magic-link tokens are stored hashed — the raw token only ever lives in the link. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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
            magicLinkToken: hashToken(token),
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
