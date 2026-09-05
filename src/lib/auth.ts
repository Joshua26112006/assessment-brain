import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authorizeCredentials, authCallbacks } from "@/lib/auth-credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: authCallbacks,
});
