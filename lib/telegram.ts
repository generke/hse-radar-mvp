import { createAdminClient } from "@/lib/supabase/admin";

export const telegramBotUsername=process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME||"hse_radar_safety_bot";

export async function telegramSecret(key:"bot_token"|"webhook_secret"){
 if(key==="bot_token"&&process.env.TELEGRAM_BOT_TOKEN)return process.env.TELEGRAM_BOT_TOKEN;
 const admin=createAdminClient();
 const {data}=await admin.from("vision_platform_secrets").select("secret_value").eq("secret_key",key).maybeSingle();
 return data?.secret_value||"";
}

export async function sendTelegram(chatId:string,text:string){
 const token=await telegramSecret("bot_token");
 if(!token)throw new Error("Telegram-бот не настроен.");
 const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
 if(!response.ok){const details=await response.json().catch(()=>null);throw new Error(details?.description||"Telegram отклонил сообщение.")}
 return response.json();
}
