import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/dashboard-path";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (the `middleware` file
// convention is deprecated). Proxy defaults to the Node.js runtime here.
//
// Session strategy is JWT, so `auth()` only decodes/verifies the signed
// cookie — no database call happens in this file.

export const proxy = auth((req) => {
  const { pathname, origin } = req.nextUrl;
  const session = req.auth;

  const isTeacherRoute = pathname.startsWith("/teacher");
  const isStudentRoute = pathname.startsWith("/student");
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if ((isTeacherRoute || isStudentRoute) && !session) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  if (session) {
    const role = session.user.role;
    const home = dashboardPathForRole(role);

    if (isTeacherRoute && role !== "TEACHER") {
      return NextResponse.redirect(new URL(home, origin));
    }
    if (isStudentRoute && role !== "STUDENT") {
      return NextResponse.redirect(new URL(home, origin));
    }
    if (isAuthPage) {
      return NextResponse.redirect(new URL(home, origin));
    }
  }

  return NextResponse.next();
});

// Scoped allowlist rather than a blanket matcher with exclusions: proxy only
// ever runs for these paths, so every other route (including all /api/*
// routes — Auth.js's own handlers and /api/auth/register — and the landing
// page) is never touched here, avoiding accidental blocking or loops.
export const config = {
  matcher: ["/teacher/:path*", "/student/:path*", "/login", "/register"],
};
