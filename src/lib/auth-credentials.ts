import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Fixed, non-secret bcrypt hash of an arbitrary, unused string. Comparing
 * against this when no user is found keeps authorize()'s response time
 * roughly the same as a real (wrong-password) failure, so a timing
 * difference can't be used to enumerate which emails have accounts.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$10$3bjEOE4DZ8Z1V7w6l5VlyeH5iNvxx9cNGzlvq/zJbx4L4G7FXNbru";

/**
 * Core credentials check. Deliberately kept free of any `next-auth` runtime
 * import (only its types) so it can be exercised directly — e.g. in tests —
 * without pulling in Auth.js's Next.js integration, which transitively
 * depends on the Next.js server runtime and cannot be loaded outside of it.
 *
 * Every failure path — malformed input, unknown email, wrong password —
 * returns the same `null`, so callers can never distinguish "no such user"
 * from "wrong password" from the result alone.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
) {
  const email = credentials?.email;
  const password = credentials?.password;

  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

/**
 * Named separately from the `NextAuth()` wiring in auth.ts so the role/id
 * propagation logic can be exercised directly without a full Auth.js
 * request/JWT cycle.
 */
export const authCallbacks = {
  // Runs on every JWT read; `user` is only present right after a
  // successful authorize() call (initial sign-in), which is the one
  // moment the database-sourced role is available to copy into the token.
  async jwt({
    token,
    user,
  }: {
    token: JWT;
    user?: { id: string; role: JWT["role"] } | null;
  }) {
    if (user) {
      token.id = user.id;
      token.role = user.role;
    }
    return token;
  },
  // Auth.js only exposes a subset of the token on `session` by default;
  // id/role must be copied across explicitly to reach the client/server
  // session object.
  //
  // The explicit `{ session, token }: { session: Session; token: JWT }`
  // annotation looks redundant (Auth.js's own docs call it unnecessary for
  // this callback) but is required here: without it, in this next-auth
  // 5.0.0-beta.32 config shape, `token`'s inferred type collapses to `{}`
  // instead of the augmented `JWT`, which silently makes
  // `token.id`/`token.role` type as `{}` and fails to compile.
  async session({ session, token }: { session: Session; token: JWT }) {
    if (token.id) {
      session.user.id = token.id;
    }
    if (token.role) {
      session.user.role = token.role;
    }
    return session;
  },
};
