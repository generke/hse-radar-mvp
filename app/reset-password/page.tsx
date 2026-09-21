"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { RadarLogo } from "@/components/logo";

export default function ResetPasswordPage() {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [success,setSuccess]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setBusy(true);setMessage("");
    const form=new FormData(event.currentTarget);const password=String(form.get("password")||"");const confirm=String(form.get("confirm")||"");
    if(password!==confirm){setBusy(false);setMessage("Пароли не совпадают.");return}
    const{error}=await createClient().auth.updateUser({password});setBusy(false);
    if(error){setMessage(error.message);return}setSuccess(true);setMessage("Пароль изменён. Теперь можно войти в систему.");
  }
  return <main className="auth-page"><section className="auth-copy"><RadarLogo/><p className="kicker">БЕЗОПАСНОСТЬ АККАУНТА</p><h1>Новый пароль</h1><p>Используйте не менее 8 символов и не повторяйте пароль от рабочей почты.</p></section><form className="auth-card" method="post" onSubmit={submit}><span className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</span><h2>Задайте новый пароль</h2>{!success&&<><label>Новый пароль<input name="password" type="password" autoComplete="new-password" minLength={8} required disabled={busy}/></label><label>Повторите пароль<input name="confirm" type="password" autoComplete="new-password" minLength={8} required disabled={busy}/></label></>}{message&&<p className={success?"form-success":"form-error"} role="status">{message}</p>}{success?<Link className="button primary wide" href="/">Перейти ко входу</Link>:<button className="button primary wide submit-button" disabled={busy} aria-busy={busy}>{busy?"Сохранение…":"Сохранить пароль"}</button>}</form></main>;
}
