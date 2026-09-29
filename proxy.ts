import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const startedAt = performance.now();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  try {
    await Promise.race([
      supabase.auth.getClaims(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AUTH_REFRESH_TIMEOUT")), 8000)),
    ]);
  } catch (error) {
    // A revoked or stale refresh token must never leave the application on an
    // endless loading screen. Remove only Supabase auth cookies and let the
    // request continue to the sign-in screen.
    const authCookies = request.cookies
      .getAll()
      .filter(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
    authCookies.forEach(({ name }) => request.cookies.delete(name));
    response = NextResponse.next({ request });
    authCookies.forEach(({ name }) => response.cookies.set(name, "", { path: "/", maxAge: 0 }));
    console.warn("auth.session.cleared", {
      cookies: authCookies.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Keep authentication observable without issuing any extra request. This
  // lets slow navigations be separated from page rendering in production.
  response.headers.set("Server-Timing", `auth;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return response;
}

export const config = {
  // Only application pages need an auth refresh. Running Auth for icons and a
  // public health probe adds latency and unnecessary Supabase traffic.
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon(?:-precomposed)?\\.png).*)"],
};
