import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Extends Auth.js's built-in types with the fields this app actually
 * returns from `authorize()` and propagates through the JWT/session.
 * `role` is typed against the existing Prisma `Role` enum (rather than a
 * duplicated string union) so the two can never drift apart.
 */
declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
  }
}
