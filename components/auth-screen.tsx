"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "./logo";

export function AuthScreen({ supabaseUrl = "", supabaseKey = "" }: { supabaseUrl?: string; supabaseKey?: string } = {}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")); const password = String(form.get("password"));
    const supabase = createClient(supabaseUrl, supabaseKey);
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: String(form.get("name") || "") } } });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    if (mode === "signup" && !result.data.session) return setError("Проверьте почту и подтвердите регистрацию.");
    window.location.reload();
  }
  return <main className="auth-page"><section className="auth-copy"><RadarLogo /><p className="kicker">ОПЕРАТИВНЫЙ КОНТРОЛЬ HSE</p><h1>Важное становится<br/><em>видимым вовремя.</em></h1><p>Сотрудники, допуски, инструктажи, СИЗ, оборудование и документы — в одной системе.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">{mode === "login" ? "Вход в систему" : "Новая организация"}</span><h2>{mode === "login" ? "С возвращением" : "Создать пространство"}</h2>{mode === "signup" && <label>Имя<input name="name" required /></label>}<label>Рабочая почта<input name="email" type="email" required /></label><label>Пароль<input name="password" type="password" minLength={8} required /></label>{error && <p className="form-error">{error}</p>}<button className="button primary wide" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}</button><button className="text-button" type="button" onClick={() => {setError("");setMode(mode === "login" ? "signup" : "login")}}>{mode === "login" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}</button></form></main>;
}
