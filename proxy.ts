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
  await supabase.auth.getClaims();
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
