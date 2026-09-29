import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const sameOrigin = (request: NextRequest) =>
  !request.headers.get("origin") || request.headers.get("origin") === request.nextUrl.origin;

const withTimeout = <T,>(promise: Promise<T>, milliseconds = 15000) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AUTH_TIMEOUT")), milliseconds),
    ),
  ]);

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    }
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
      return NextResponse.json({ error: "Введите почту и пароль." }, { status: 400 });
    }

    const supabase = await createClient();
    const result = await withTimeout(supabase.auth.signInWithPassword({ email, password }));
    if (result.error) {
      console.warn("auth.login.rejected", { code: result.error.code, status: result.error.status });
      const message = result.error.code === "email_not_confirmed"
        ? "Сначала подтвердите электронную почту."
        : "Неверная почта или пароль.";
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const timeout = error instanceof Error && error.message === "AUTH_TIMEOUT";
    console.error("auth.login.failed", {
      timeout,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: timeout ? "Сервер авторизации не ответил вовремя. Повторите вход." : "Не удалось выполнить вход. Повторите попытку." },
      { status: timeout ? 504 : 500 },
    );
  }
}
