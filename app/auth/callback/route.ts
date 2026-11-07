import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (code && url && key) {
    const cookieStore = await cookies();
    const db = createServerClient(url, key, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: values => {
          values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    });
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const report = request.nextUrl.searchParams.get("report");
      const target = new URL("/", request.url);
      if (report && /^[a-f0-9-]{36}$/i.test(report)) target.hash = "report=" + report;
      return NextResponse.redirect(target);
    }
  }
  return NextResponse.redirect(new URL("/?auth_error=google", request.url));
}
