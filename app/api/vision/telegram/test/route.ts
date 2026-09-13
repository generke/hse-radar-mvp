import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:NextRequest){
 try{
  if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
  const {organizationId,targetId}=await request.json(),supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
  const {error}=await supabase.rpc("vision_send_telegram_target",{p_organization_id:String(organizationId||""),p_target_id:String(targetId||"")});
  if(error)throw error;
  return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Ошибка отправки."},{status:500})}
}
