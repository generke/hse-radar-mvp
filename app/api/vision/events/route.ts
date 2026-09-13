import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegram } from "@/lib/telegram";

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
  let telegramSent=0;
  if(body.notify!==false&&process.env.SUPABASE_SERVICE_ROLE_KEY){
   const admin=createAdminClient();
   const [{data:settings},{data:targets},{data:camera}]=await Promise.all([
    admin.from("vision_notification_settings").select("enabled").eq("organization_id",organizationId).maybeSingle(),
    admin.from("vision_notification_targets").select("id,chat_id,label").eq("organization_id",organizationId).eq("enabled",true),
    admin.from("vision_cameras").select("name,location").eq("id",cameraId).maybeSingle(),
   ]);
   if(settings?.enabled!==false&&targets?.length){
    const text=`🚨 HSE Radar\nДвижение внутри опасной зоны\nКамера: ${camera?.name||"Камера"}\nОбъект: ${camera?.location||"Не указан"}\nВремя: ${new Intl.DateTimeFormat("ru-RU",{dateStyle:"short",timeStyle:"medium",timeZone:"Asia/Almaty"}).format(new Date())}`;
    const results=await Promise.allSettled(targets.map(target=>sendTelegram(target.chat_id,text)));
    telegramSent=results.filter(result=>result.status==="fulfilled").length;
   }
  }
  return NextResponse.json({event,telegramSent});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось сохранить событие."},{status:500})}
}
