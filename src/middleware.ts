import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { CRON_PATH, cronAuthMatches } from "@/lib/cron-auth";

/**
 * Gate everything except the login route and Next's own assets. This covers
 * pages, route handlers AND Server Action POSTs (they post to the page route,
 * which the matcher includes).
 */
export async function middleware(request: NextRequest) {
  // Vercel Cron has no session cookie. It sends Authorization: Bearer
  // $CRON_SECRET instead. Check that here rather than excluding the path from
  // the matcher — an excluded path is a URL outside the gate, and this repo
  // already had a hole from exactly that (see config.matcher below).
  //
  // This runs before the APP_PASSWORD short-circuit so the branch behaves the
  // same locally as in production: no header, no entry.
  if (request.nextUrl.pathname === CRON_PATH) {
    return cronAuthMatches(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
      ? NextResponse.next()
      : NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // No password configured (local dev) → the gate is disabled entirely.
  if (!process.env.APP_PASSWORD) return NextResponse.next();

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(session)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  // API/Server-Action requests get a status, not an HTML redirect.
  if (pathname.startsWith("/api/") || request.method === "POST") {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("from", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except the login page, Next internals and the generated icons.
    //
    // Do NOT exclude "anything ending in an image extension" here. That let
    // /api/vaccination-photos/1.jpg reach the handler with no session (the
    // handler used parseInt, which reads "1.jpg" as 1) and served the
    // certificate — name, address and phone — to anyone. public/ is empty, so
    // the only static files are these two generated icons, and they are art.
    // Each alternative is anchored. Unanchored "login" would also exclude
    // /loginXXX, and a bare "." matches any character.
    "/((?!login$|login/|_next/static/|_next/image|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$).*)",
  ],
};
