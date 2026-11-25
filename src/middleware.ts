import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors at "/" see the public landing page instead of being
// bounced to a sign-in form. Signed-in staff go straight to their board.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("rc_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/"] };
