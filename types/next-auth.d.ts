import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      tenantId: string;
      role: string;
    };
  }
  interface User {
    tenantId?: string;
    role?: string;
  }
}
