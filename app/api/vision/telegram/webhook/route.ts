import { createHash } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TelegramUpdate={message?:{text?:string;chat:{id:number;type:string};from?:{id:number;first_name?:string;last_name?:string;username?:string}}};

export async function POST(request:NextRequest){
 try{
  const webhookSecret=request.headers.get("x-telegram-bot-api-secret-token");
  if(!webhookSecret)return NextResponse.json({ok:false},{status:401});
  const update=await request.json() as TelegramUpdate,message=update.message,match=message?.text?.match(/^\/start\s+([A-Za-z0-9_-]+)$/);
  if(!message||!match)return NextResponse.json({ok:true});
  const label=[message.from?.first_name,message.from?.last_name].filter(Boolean).join(" ")||message.from?.username||"Telegram-пользователь";
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new Error("Supabase environment is incomplete");
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),hash=createHash("sha256").update(match[1]).digest("hex");
  const {data,error}=await supabase.rpc("vision_process_telegram_pairing",{p_webhook_secret:webhookSecret,p_code_hash:hash,p_chat_id:String(message.chat.id),p_telegram_user_id:message.from?.id?String(message.from.id):null,p_label:label});
  if(error)throw error;
  if(data==="unauthorized")return NextResponse.json({ok:false},{status:401});
  return NextResponse.json({ok:true});
 }catch(error){console.error("Telegram webhook error",error);return NextResponse.json({ok:false},{status:500})}
}
