/**
 * The first gate.
 *
 * Middleware runs on the edge and has no database, so it cannot know what role
 * a session holds. What it can do, cheaply and on every request, is turn away
 * anyone without a session cookie before a page renders.
 *
 * The authoritative role check is in each surface's layout, which runs on the
 * server with the database and the full principal: app/(portal)/app/layout.tsx,
 * app/(portal)/review/layout.tsx, app/(portal)/admin/layout.tsx. A layout is
 * not skippable by any route beneath it, which is what makes it the right place
 * for the real decision. tests/authorization.test.ts checks the outcome by
 * request against every route, so the split cannot silently drift.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PROTECTED = ['/app', '/review', '/admin', '/account'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const needsSession = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!needsSession) return NextResponse.next();

  if (!getSessionCookie(request)) {
    const signIn = new URL('/sign-in', request.url);
    // Come back here once they are in, rather than dumping them on a dashboard.
    signIn.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/review/:path*', '/admin/:path*', '/account/:path*'],
};
