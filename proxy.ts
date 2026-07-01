/**
 * proxy.ts (Next.js "middleware" replacement in this version)
 * Provides optimistic auth checks + redirects.
 * See node_modules/next/dist/docs/.../proxy.md and authentication.md
 * For SPA n8nlike: serve the editor page always (client renders login), protect API + future pages.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "./lib/session";

const PUBLIC_ROUTES = ["/api/auth/login", "/api/auth/signup", "/api/auth/me", "/api/auth/logout"];
// Webhooks and forms are entry points (can be called externally); still scope internally via wf user
const WEBHOOK_PREFIX = "/api/webhooks/";
const FORM_PREFIX = "/api/forms/";

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Allow public auth endpoints + webhooks + forms + static assets + next internals
  if (
    PUBLIC_ROUTES.includes(path) ||
    path.startsWith(WEBHOOK_PREFIX) ||
    path.startsWith(FORM_PREFIX) ||
    path.startsWith("/_next") ||
    path.startsWith("/api/_") ||
    path.includes(".") // assets etc
  ) {
    return NextResponse.next();
  }

  // For API routes (except public), require valid session
  if (path.startsWith("/api/")) {
    const sessionCookie = req.cookies.get("session")?.value;
    const session = await decrypt(sessionCookie);
    if (!session?.userId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    // Pass user info downstream via request header (consumed by route handlers if needed)
    const res = NextResponse.next();
    res.headers.set("x-user-id", session.userId);
    res.headers.set("x-user-email", session.email);
    return res;
  }

  // For the main SPA page (/) and any client routes: allow, client-side will gate on /me
  // (No hard redirect so login form can be shown in the same page without SPA nav issues)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon etc (static)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
