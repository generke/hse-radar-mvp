import { createHash } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegram,telegramSecret } from "@/lib/telegram";

type TelegramUpdate={message?:{text?:string;chat:{id:number;type:string};from?:{id:number;first_name?:string;last_name?:string;username?:string}}};

export async function POST(request:NextRequest){
 try{
  const expected=await telegramSecret("webhook_secret");
  if(!expected||request.headers.get("x-telegram-bot-api-secret-token")!==expected)return NextResponse.json({ok:false},{status:401});
  const update=await request.json() as TelegramUpdate,message=update.message,match=message?.text?.match(/^\/start\s+([A-Za-z0-9_-]+)$/);
  if(!message||!match)return NextResponse.json({ok:true});
  const admin=createAdminClient(),hash=createHash("sha256").update(match[1]).digest("hex"),{data:pairing}=await admin.from("vision_telegram_pairings").select("id,organization_id,user_id,expires_at,used_at").eq("token_hash",hash).maybeSingle();
  if(!pairing||pairing.used_at||new Date(pairing.expires_at)<new Date()){await sendTelegram(String(message.chat.id),"Ссылка HSE Radar недействительна. Создайте новую ссылку в разделе Safety Vision.");return NextResponse.json({ok:true})}
  const label=[message.from?.first_name,message.from?.last_name].filter(Boolean).join(" ")||message.from?.username||"Telegram-пользователь";
  const {error}=await admin.from("vision_notification_targets").upsert({organization_id:pairing.organization_id,recipient_user_id:pairing.user_id,telegram_user_id:message.from?.id?String(message.from.id):null,label,chat_id:String(message.chat.id),enabled:true},{onConflict:"organization_id,chat_id"});
  if(error)throw error;
  await admin.from("vision_telegram_pairings").update({used_at:new Date().toISOString()}).eq("id",pairing.id);
  await sendTelegram(String(message.chat.id),"✅ Telegram подключён к вашей организации в HSE Radar. Теперь сюда будут приходить события Safety Vision только этой организации.");
  return NextResponse.json({ok:true});
 }catch(error){console.error("Telegram webhook error",error);return NextResponse.json({ok:false},{status:500})}
}
