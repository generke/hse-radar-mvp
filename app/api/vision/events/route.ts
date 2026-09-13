import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const allowedEvents=new Set(["danger_zone","no_helmet","no_vest","blocked_exit","manual"]);
const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;

export async function POST(request:NextRequest){
 try{
  if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
  const body=await request.json(),organizationId=String(body.organizationId||""),cameraId=String(body.cameraId||""),eventType=String(body.eventType||"");
  if(!organizationId||!cameraId||!allowedEvents.has(eventType))return NextResponse.json({error:"Некорректные данные события."},{status:400});
  const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
  const {data:event,error}=await supabase.from("vision_events").insert({organization_id:organizationId,camera_id:cameraId,event_type:eventType,confidence:Number(body.confidence)||null,status:"new",notes:String(body.notes||"")||null}).select().single();
  if(error)throw error;
  return NextResponse.json({event,telegramQueued:body.notify!==false});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось сохранить событие."},{status:500})}
}
