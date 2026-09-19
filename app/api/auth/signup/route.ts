import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
    const email=String(body.email||"").trim().toLowerCase();
    const password=String(body.password||"");
    const fullName=String(body.fullName||"").trim();
    if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||!fullName)return NextResponse.json({error:"Проверьте имя, почту и пароль."},{status:400});
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
    const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
    if(!url||!key)throw new Error("Supabase environment is incomplete");
    const site=process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin;
    const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await auth.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:`${site.replace(/\/$/,"")}/auth/callback?next=/`}});
    if(result.error)return NextResponse.json({error:result.error.message},{status:400});
    const user=result.data.user;
    const isNew=Boolean(user?.identities?.length);
    if(user&&isNew){
      // Registration already succeeded. Delivery failures are logged and retried
      // manually; they must never make the browser report a failed signup.
      try{
        const admin=createAdminClient();
        const {data:event}=await admin.from("registration_notification_events").select("user_id,organization_id,email,full_name,processed_at").eq("user_id",user.id).maybeSingle();
        if(event&&!event.processed_at){
          const {data:platformAdmins}=await admin.from("platform_admins").select("user_id");
          const adminIds=(platformAdmins||[]).map(item=>item.user_id);
          if(adminIds.length)await admin.from("user_notifications").upsert(adminIds.map(userId=>({organization_id:event.organization_id,user_id:userId,notification_date:almatyDate(),source_key:`new-registration:${event.user_id}`,title:"Новый пользователь зарегистрирован",body:`${event.full_name||fullName} · ${event.email}`,severity:"warning"})),{onConflict:"organization_id,user_id,notification_date,source_key"});
          const configuredEmail=process.env.PLATFORM_ADMIN_EMAIL;
          const adminEmails:string[]=[];
          if(configuredEmail)adminEmails.push(configuredEmail);
          else for(const adminId of adminIds){const {data}=await admin.auth.admin.getUserById(adminId);if(data.user?.email)adminEmails.push(data.user.email)}
          if(adminEmails.length)await sendTransactionalEmail({to:[...new Set(adminEmails)],subject:"HSE Radar: новая регистрация",heading:"Новый пользователь зарегистрирован",body:`${event.full_name||fullName} (${event.email}) самостоятельно зарегистрировался на платформе.`,actionLabel:"Открыть управление платформой",actionUrl:`${site.replace(/\/$/,"")}/?section=admin`});
          await notifyTelegramUsers(adminIds,`👤 HSE Radar\nНовый пользователь зарегистрирован\n${event.full_name||fullName}\n${event.email}`);
          await admin.from("registration_notification_events").update({processed_at:new Date().toISOString()}).eq("user_id",user.id).is("processed_at",null);
        }
      }catch(notificationError){console.error("Registration notification failed",notificationError)}
    }
    return NextResponse.json({ok:true,confirmationRequired:!result.data.session});
  }catch(error){
    console.error("Signup failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Не удалось зарегистрироваться."},{status:500});
  }
}
