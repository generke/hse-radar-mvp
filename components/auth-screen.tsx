"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "./logo";
import { LanguageSwitcher } from "./language-provider";

export function AuthScreen({ supabaseUrl = "", supabaseKey = "" }: { supabaseUrl?: string; supabaseKey?: string } = {}) {
  const params=useSearchParams();const invited=Boolean(params.get("invitation"));
  const [mode, setMode] = useState<"login" | "signup">(invited?"signup":"login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(busy)return; setBusy(true); setError("");
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
  return <main className="auth-page"><div className="auth-language"><LanguageSwitcher/></div><section className="auth-copy"><RadarLogo /><p className="kicker">ОПЕРАТИВНЫЙ КОНТРОЛЬ HSE</p><h1>Важное становится<br/><em>видимым вовремя.</em></h1><p>Сотрудники, допуски, инструктажи, СИЗ, оборудование и документы — в одной системе.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">{invited?"ПРИГЛАШЕНИЕ В ОРГАНИЗАЦИЮ":mode === "login" ? "Вход в систему" : "Новая организация"}</span><h2>{invited?"Создайте аккаунт":mode === "login" ? "С возвращением" : "Создать пространство"}</h2>{invited&&<p className="muted">После регистрации откроются разделы, назначенные руководителем.</p>}{mode === "signup" && <label>Имя<input name="name" required disabled={busy}/></label>}<label>Рабочая почта<input name="email" type="email" defaultValue={params.get("email")||""} readOnly={invited} required disabled={busy}/></label><label>Пароль<input name="password" type="password" minLength={8} required disabled={busy}/></label>{error && <p className="form-error">{error}</p>}<button className={`button primary wide submit-button ${busy?"loading":""}`} disabled={busy} aria-busy={busy}>{busy&&<i className="button-spinner"/>}<span>{busy ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться"}</span></button>{!invited&&<button className="text-button" type="button" disabled={busy} onClick={() => {setError("");setMode(mode === "login" ? "signup" : "login")}}>{mode === "login" ? "Нет аккаунта? Создать" : "Уже есть аккаунт? Войти"}</button>}</form></main>;
}
