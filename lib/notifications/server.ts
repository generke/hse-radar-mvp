import { createAdminClient } from "@/lib/supabase/admin";

const escapeHtml=(value:unknown)=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]!));

export async function sendTransactionalEmail({to,subject,heading,body,actionLabel,actionUrl}:{to:string|string[];subject:string;heading:string;body:string;actionLabel?:string;actionUrl?:string}){
  const apiKey=process.env.RESEND_API_KEY;
  const from=process.env.EMAIL_FROM;
  if(!apiKey||!from)return {ok:false,skipped:true,error:"Email provider is not configured"};
  const recipients=Array.isArray(to)?to:[to];
  if(!recipients.length)return {ok:false,skipped:true,error:"Recipient is missing"};
  const action=actionLabel&&actionUrl?`<p style="margin:26px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#101828;color:#fff;text-decoration:none;border-radius:9px">${escapeHtml(actionLabel)}</a></p>`:"";
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({from,to:recipients,subject,html:`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#101828"><p style="color:#16a36a;font-weight:700">HSE RADAR</p><h1 style="font-size:25px">${escapeHtml(heading)}</h1><p style="line-height:1.65">${escapeHtml(body)}</p>${action}<p style="color:#98a2b3;font-size:12px">Автоматическое сообщение HSE Radar.</p></div>`})});
  const result=await response.json().catch(()=>({})) as {id?:string;message?:string};
  return {ok:response.ok,id:result.id,error:response.ok?undefined:result.message||`HTTP ${response.status}`};
}

export async function notifyTelegramUsers(userIds:string[],message:string){
  if(!userIds.length)return {sent:0,failed:0};
  const admin=createAdminClient();
  const {data:targets,error}=await admin.from("vision_notification_targets").select("chat_id").in("recipient_user_id",userIds).eq("enabled",true);
  if(error)return {sent:0,failed:1,error:error.message};
  const chats=[...new Set((targets||[]).map(item=>String(item.chat_id)).filter(Boolean))];
  let sent=0,failed=0;
  for(const chatId of chats){const result=await admin.rpc("vision_send_telegram",{p_chat_id:chatId,p_text:message});if(result.error)failed++;else sent++}
  return {sent,failed};
}
