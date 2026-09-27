import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTelegramUsers, sendTransactionalEmail } from "@/lib/notifications/server";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;
const almatyDate=()=>{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value=(type:string)=>parts.find(part=>part.type===type)?.value||"";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export async function POST(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body=await request.json();
    const userId=String(body.userId||"");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))return NextResponse.json({error:"Некорректный идентификатор регистрации."},{status:400});
    const site=process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin;
    // The browser performs sign-up so the PKCE verifier survives until the
    // email callback. This endpoint only processes the durable, server-created
    // registration event and is idempotent.
    const admin=createAdminClient();
    const {data:event}=await admin.from("registration_notification_events").select("user_id,organization_id,email,full_name,processed_at").eq("user_id",userId).maybeSingle();
    if(event&&!event.processed_at){
      const {data:platformAdmins}=await admin.from("platform_admins").select("user_id");
      const adminIds=(platformAdmins||[]).map(item=>item.user_id);
      if(adminIds.length)await admin.from("user_notifications").upsert(adminIds.map(adminUserId=>({organization_id:event.organization_id,user_id:adminUserId,notification_date:almatyDate(),source_key:`new-registration:${event.user_id}`,title:"Новый пользователь зарегистрирован",body:`${event.full_name||event.email} · ${event.email}`,severity:"warning"})),{onConflict:"organization_id,user_id,notification_date,source_key"});
      const configuredEmail=process.env.PLATFORM_ADMIN_EMAIL;
      const adminEmails:string[]=[];
      if(configuredEmail)adminEmails.push(configuredEmail);
      else for(const adminId of adminIds){const {data}=await admin.auth.admin.getUserById(adminId);if(data.user?.email)adminEmails.push(data.user.email)}
      if(adminEmails.length)await sendTransactionalEmail({to:[...new Set(adminEmails)],subject:"HSE Radar: новая регистрация",heading:"Новый пользователь зарегистрирован",body:`${event.full_name||event.email} (${event.email}) самостоятельно зарегистрировался на платформе.`,actionLabel:"Открыть управление платформой",actionUrl:`${site.replace(/\/$/,"")}/?section=admin`});
      await notifyTelegramUsers(adminIds,`👤 HSE Radar\nНовый пользователь зарегистрирован\n${event.full_name||event.email}\n${event.email}`);
      await admin.from("registration_notification_events").update({processed_at:new Date().toISOString()}).eq("user_id",userId).is("processed_at",null);
    }
    return NextResponse.json({ok:true});
  }catch(error){
    console.error("Signup failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Не удалось зарегистрироваться."},{status:500});
  }
}
