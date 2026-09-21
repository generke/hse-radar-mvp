"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "./logo";
import { LanguageSwitcher } from "./language-provider";

export function AuthScreen({ supabaseUrl = "", supabaseKey = "" }: { supabaseUrl?: string; supabaseKey?: string } = {}) {
  const params=useSearchParams();const router=useRouter();const invited=Boolean(params.get("invitation"));
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(invited?"signup":"login");
  const [error, setError] = useState(()=>params.get("auth_error")||params.get("authError")?"Ссылка входа недействительна или устарела. Запросите новую.":"");
  const [success,setSuccess]=useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(busy)return; setBusy(true); setError("");setSuccess("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")||""); const password = String(form.get("password")||"");
    if(mode==="forgot"){
      const{error:resetError}=await createClient(supabaseUrl,supabaseKey).auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/auth/callback?next=/reset-password`});
      setBusy(false);if(resetError)return setError(resetError.message);
      setSuccess("Если аккаунт существует, ссылка для восстановления отправлена на почту.");return;
    }
    if(mode==="signup"){
      const response=await fetch("/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,fullName:String(form.get("name")||"")})});
      const body=await response.json();setBusy(false);
      if(!response.ok)return setError(body.error||"Не удалось зарегистрироваться.");
      if(body.confirmationRequired)return setSuccess("Регистрация создана. Откройте письмо и подтвердите почту — ссылка вернёт вас на главную страницу.");
      router.replace("/");router.refresh();return;
    }
    const result=await createClient(supabaseUrl, supabaseKey).auth.signInWithPassword({ email, password });
    setBusy(false);if(result.error)return setError(result.error.message);
    window.location.reload();
  }
  const resetMode=(next:"login"|"signup"|"forgot")=>{setError("");setSuccess("");setMode(next)};
  const title=mode==="forgot"?"Восстановить доступ":mode==="login"?"С возвращением":"Создать пространство";
  return <main className="auth-page"><div className="auth-language"><LanguageSwitcher/></div><section className="auth-copy"><RadarLogo /><p className="kicker">ОПЕРАТИВНЫЙ КОНТРОЛЬ HSE</p><h1>Важное становится<br/><em>видимым вовремя.</em></h1><p>Сотрудники, допуски, инструктажи, СИЗ, оборудование и документы — в одной системе.</p></section><form className="auth-card" method="post" onSubmit={submit}><span className="eyebrow">{invited?"ПРИГЛАШЕНИЕ В ОРГАНИЗАЦИЮ":mode==="forgot"?"ВОССТАНОВЛЕНИЕ ПАРОЛЯ":mode === "login" ? "Вход в систему" : "Новая организация"}</span><h2>{invited?"Создайте аккаунт":title}</h2>{invited&&<p className="muted">После регистрации откроются разделы, назначенные руководителем.</p>}{mode==="forgot"&&<p className="muted">Отправим безопасную ссылку на рабочую почту.</p>}{mode === "signup" && <label>Имя<input name="name" autoComplete="name" required disabled={busy}/></label>}<label>Рабочая почта<input name="email" type="email" autoComplete="email" defaultValue={params.get("email")||""} readOnly={invited} required disabled={busy}/></label>{mode!=="forgot"&&<label>Пароль<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} minLength={8} required disabled={busy}/></label>}{error && <p className="form-error" role="alert">{error}</p>}{success&&<p className="form-success" role="status">{success}</p>}<button className={`button primary wide submit-button ${busy?"loading":""}`} disabled={busy||Boolean(success)} aria-busy={busy}>{busy&&<i className="button-spinner"/>}<span>{busy ? "Подождите…" : mode==="forgot"?"Отправить ссылку":mode === "login" ? "Войти" : "Зарегистрироваться"}</span></button>{!invited&&mode==="login"&&<button className="text-button" type="button" disabled={busy} onClick={()=>resetMode("forgot")}>Забыли пароль?</button>}{!invited&&<button className="text-button" type="button" disabled={busy} onClick={()=>resetMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Нет аккаунта? Создать" : "Вернуться ко входу"}</button>}</form></main>;
}
