"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "./logo";

export function PasswordChangeScreen({supabaseUrl,supabaseKey}:{supabaseUrl:string;supabaseKey:string}){
  const router=useRouter();
  const[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const form=new FormData(event.currentTarget),password=String(form.get("password")||""),confirmation=String(form.get("confirmation")||"");if(password!==confirmation)return setError("Пароли не совпадают.");setBusy(true);setError("");const response=await fetch("/api/auth/password",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({password})}),body=await response.json();if(!response.ok){setBusy(false);return setError(body.error||"Не удалось изменить пароль.")}await createClient(supabaseUrl,supabaseKey).auth.refreshSession();router.replace("/");router.refresh()}
  return <main className="auth-page"><section className="auth-copy"><RadarLogo/><p className="kicker">ЗАЩИТА АККАУНТА</p><h1>Задайте свой<br/><em>новый пароль.</em></h1><p>Временный пароль больше использоваться не будет.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">ПЕРВЫЙ ВХОД</span><h2>Смена пароля</h2><label>Новый пароль<input name="password" type="password" minLength={10} autoComplete="new-password" required disabled={busy}/></label><label>Повторите пароль<input name="confirmation" type="password" minLength={10} autoComplete="new-password" required disabled={busy}/></label>{error&&<p className="form-error">{error}</p>}<button className={`button primary wide submit-button ${busy?"loading":""}`} disabled={busy}>{busy&&<i className="button-spinner"/>}<span>{busy?"Сохранение…":"Сохранить новый пароль"}</span></button></form></main>
}
