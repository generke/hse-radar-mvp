"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "./logo";
import { LanguageSwitcher } from "./language-provider";

const AUTH_TIMEOUT_MS=20_000;
const withTimeout=<T,>(operation:Promise<T>)=>Promise.race<T>([
  operation,
  new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error("AUTH_TIMEOUT")),AUTH_TIMEOUT_MS)),
]);
const authMessage=(error:unknown)=>{
  const message=error instanceof Error?error.message:String(error||"");
  if(message==="AUTH_TIMEOUT")return "Сервер авторизации отвечает слишком долго. Повторите попытку через минуту.";
  if(/email rate limit exceeded/i.test(message))return "Лимит писем временно исчерпан. Повторите попытку позже или обратитесь к администратору.";
  if(/error sending confirmation email|smtp|send.*email/i.test(message))return "Не удалось отправить письмо подтверждения. Проверьте адрес или повторите попытку позже.";
  if(/user already registered/i.test(message))return "Аккаунт с этой почтой уже существует. Войдите или восстановите пароль.";
  if(/invalid login credentials/i.test(message))return "Неверная почта или пароль.";
  if(/email not confirmed/i.test(message))return "Почта ещё не подтверждена. Откройте письмо регистрации.";
  return message||"Не удалось выполнить запрос авторизации.";
};

export function AuthScreen({ supabaseUrl = "", supabaseKey = "" }: { supabaseUrl?: string; supabaseKey?: string } = {}) {
  const params=useSearchParams();const invited=Boolean(params.get("invitation"));
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(invited?"signup":"login");
  const [error, setError] = useState(()=>params.get("auth_error")||params.get("authError")?"Ссылка входа недействительна или устарела. Запросите новую.":"");
  const [success,setSuccess]=useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(busy)return; setBusy(true); setError("");setSuccess("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")||"").trim().toLowerCase(); const password = String(form.get("password")||"");
    try{
      const supabase=createClient(supabaseUrl,supabaseKey);
      if(mode==="forgot"){
        const{error:resetError}=await withTimeout(supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/auth/callback?next=/reset-password`}));
        if(resetError)throw resetError;
        setSuccess("Если аккаунт существует, ссылка для восстановления отправлена на почту.");return;
      }
      if(mode==="signup"){
        const response=await withTimeout(fetch("/api/auth/signup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,fullName:String(form.get("name")||"").trim()})}));
        const body=await response.json().catch(()=>({})) as {error?:string};
        if(!response.ok)throw new Error(body.error||"Не удалось зарегистрироваться.");
        setSuccess("Регистрация создана. Откройте письмо и подтвердите почту — ссылка вернёт вас на главную страницу.");return;
      }
      const response=await withTimeout(fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})}));
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(body.error||"Не удалось выполнить вход.");
      window.location.replace("/");
    }catch(authError){setError(authMessage(authError))}
    finally{setBusy(false)}
  }
  const resetMode=(next:"login"|"signup"|"forgot")=>{setError("");setSuccess("");setMode(next)};
  const title=mode==="forgot"?"Восстановить доступ":mode==="login"?"С возвращением":"Создать пространство";
  return <main className="auth-page"><div className="auth-language"><LanguageSwitcher/></div><section className="auth-copy"><RadarLogo /><p className="kicker">ОПЕРАТИВНЫЙ КОНТРОЛЬ HSE</p><h1>Важное становится<br/><em>видимым вовремя.</em></h1><p>Сотрудники, допуски, инструктажи, СИЗ, оборудование и документы — в одной системе.</p></section><form className="auth-card" method="post" onSubmit={submit}><span className="eyebrow">{invited?"ПРИГЛАШЕНИЕ В ОРГАНИЗАЦИЮ":mode==="forgot"?"ВОССТАНОВЛЕНИЕ ПАРОЛЯ":mode === "login" ? "Вход в систему" : "Новая организация"}</span><h2>{invited?"Создайте аккаунт":title}</h2>{invited&&<p className="muted">После регистрации откроются разделы, назначенные руководителем.</p>}{mode==="forgot"&&<p className="muted">Отправим безопасную ссылку на рабочую почту.</p>}{mode === "signup" && <label>Имя<input name="name" autoComplete="name" required disabled={busy}/></label>}<label>Рабочая почта<input name="email" type="email" autoComplete="email" defaultValue={params.get("email")||""} readOnly={invited} required disabled={busy}/></label>{mode!=="forgot"&&<label>Пароль<input name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} minLength={8} required disabled={busy}/></label>}{error && <p className="form-error" role="alert">{error}</p>}{success&&<p className="form-success" role="status">{success}</p>}<button className={`button primary wide submit-button ${busy?"loading":""}`} disabled={busy||Boolean(success)} aria-busy={busy}>{busy&&<i className="button-spinner"/>}<span>{busy ? "Подождите…" : mode==="forgot"?"Отправить ссылку":mode === "login" ? "Войти" : "Зарегистрироваться"}</span></button>{!invited&&mode==="login"&&<button className="text-button" type="button" disabled={busy} onClick={()=>resetMode("forgot")}>Забыли пароль?</button>}{!invited&&<button className="text-button" type="button" disabled={busy} onClick={()=>resetMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Нет аккаунта? Создать" : "Вернуться ко входу"}</button>}</form></main>;
}
