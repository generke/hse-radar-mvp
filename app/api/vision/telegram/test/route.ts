import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTelegram } from "@/lib/telegram";

export async function POST(request:NextRequest){
 try{
  if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
  const {organizationId,targetId}=await request.json(),supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
  const {data:target,error}=await supabase.from("vision_notification_targets").select("chat_id,label").eq("organization_id",String(organizationId||"")).eq("id",String(targetId||"")).single();
  if(error||!target)return NextResponse.json({error:"Получатель не найден или недоступен."},{status:404});
  await sendTelegram(target.chat_id,`✅ HSE Radar · Safety Vision\nТестовые уведомления для «${target.label}» работают.`);
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Ошибка отправки."},{status:500})}
}
