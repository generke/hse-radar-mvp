import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTelegramUsers, sendTransactionalEmail } from "@/lib/notifications/server";
import { checkAuthEmailRateLimit } from "@/lib/auth/email-rate-limit";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;
const almatyDate=()=>{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value=(type:string)=>parts.find(part=>part.type===type)?.value||"";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export async function GET(){
  return NextResponse.json({mode:process.env.RESEND_API_KEY&&process.env.EMAIL_FROM?"email_confirmation":"direct"});
}

export async function POST(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body=await request.json();
    const email=String(body.email||"").trim().toLowerCase();
    const password=String(body.password||"");
    const fullName=String(body.fullName||"").trim();
    const website=String(body.website||"").trim();
    if(website)return NextResponse.json({ok:true,confirmationRequired:true},{status:202});
    if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8||!fullName)return NextResponse.json({error:"Проверьте имя, почту и пароль."},{status:400});
    if(!await checkAuthEmailRateLimit(request,email,"signup"))return NextResponse.json({error:"Слишком много попыток. Подождите 10 минут и повторите."},{status:429,headers:{"Retry-After":"600"}});

    const admin=createAdminClient();
    const site=(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin).replace(/\/$/,"");
    const emailDeliveryConfigured=Boolean(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM);
    const {data:profile}=await admin.from("profiles").select("id").ilike("email",email).maybeSingle();
    let isNew=!profile?.id;
    let userId="";
    let confirmationUrl="";
    if(profile?.id){
      const existing=await admin.auth.admin.getUserById(profile.id);
      if(existing.error)throw existing.error;
      if(existing.data.user.email_confirmed_at)return NextResponse.json({error:"Этот адрес уже зарегистрирован. Используйте вход или восстановление пароля."},{status:409});
      const updated=await admin.auth.admin.updateUserById(profile.id,{password,email_confirm:!emailDeliveryConfigured,user_metadata:{...existing.data.user.user_metadata,full_name:fullName},app_metadata:{...existing.data.user.app_metadata,...(!emailDeliveryConfigured?{email_verification:"deferred"}:{})}});
      if(updated.error)throw updated.error;
      userId=profile.id;
      if(emailDeliveryConfigured){
        const link=await admin.auth.admin.generateLink({type:"magiclink",email});
        if(link.error)throw link.error;
        confirmationUrl=`${site}/auth/callback?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=${encodeURIComponent(link.data.properties.verification_type)}&next=/`;
      }
      isNew=false;
    }else if(emailDeliveryConfigured){
      const link=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:{full_name:fullName}}});
      if(link.error)throw link.error;
      userId=link.data.user.id;
      confirmationUrl=`${site}/auth/callback?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=${encodeURIComponent(link.data.properties.verification_type)}&next=/`;
    }else{
      const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName},app_metadata:{email_verification:"deferred"}});
      if(created.error)throw created.error;
      userId=created.data.user.id;
    }
    if(emailDeliveryConfigured){
      const delivery=await sendTransactionalEmail({to:email,subject:"Подтвердите регистрацию в HSE Radar",heading:"Подтвердите электронную почту",body:"Нажмите кнопку, чтобы завершить регистрацию и открыть рабочее пространство.",actionLabel:"Подтвердить и продолжить",actionUrl:confirmationUrl});
      if(!delivery.ok){
        console.error("auth.signup.confirmation_delivery_failed",{error:delivery.error,skipped:delivery.skipped});
        if(isNew)await admin.auth.admin.deleteUser(userId,true).catch(cleanupError=>console.error("auth.signup.rollback_failed",cleanupError));
        return NextResponse.json({error:"Не удалось доставить письмо подтверждения. Попробуйте ещё раз через несколько минут."},{status:503});
      }
    }
    if(isNew)await notifyAdministrators(admin,userId,fullName,email,site);
    return NextResponse.json({ok:true,confirmationRequired:emailDeliveryConfigured});
  }catch(error){
    console.error("auth.signup.failed",{error:error instanceof Error?error.message:String(error)});
    return NextResponse.json({error:"Не удалось зарегистрироваться. Повторите попытку."},{status:500});
  }
}

async function notifyAdministrators(admin:ReturnType<typeof createAdminClient>,userId:string,fullName:string,email:string,site:string){
  try{
    const {data:event}=await admin.from("registration_notification_events").select("user_id,organization_id,email,full_name,processed_at").eq("user_id",userId).maybeSingle();
    if(!event||event.processed_at)return;
    const {data:platformAdmins}=await admin.from("platform_admins").select("user_id");
    const adminIds=(platformAdmins||[]).map(item=>item.user_id);
    if(adminIds.length)await admin.from("user_notifications").upsert(adminIds.map(adminUserId=>({organization_id:event.organization_id,user_id:adminUserId,notification_date:almatyDate(),source_key:`new-registration:${event.user_id}`,title:"Новый пользователь зарегистрирован",body:`${event.full_name||fullName} · ${event.email||email}`,severity:"warning"})),{onConflict:"organization_id,user_id,notification_date,source_key"});
    const adminEmails:string[]=[];
    if(process.env.PLATFORM_ADMIN_EMAIL)adminEmails.push(process.env.PLATFORM_ADMIN_EMAIL);
    else for(const adminId of adminIds){const {data}=await admin.auth.admin.getUserById(adminId);if(data.user?.email)adminEmails.push(data.user.email)}
    if(adminEmails.length)await sendTransactionalEmail({to:[...new Set(adminEmails)],subject:"HSE Radar: новая регистрация",heading:"Новый пользователь зарегистрирован",body:`${event.full_name||fullName} (${event.email||email}) самостоятельно зарегистрировался на платформе.`,actionLabel:"Открыть управление платформой",actionUrl:`${site}/?section=admin`});
    await notifyTelegramUsers(adminIds,`👤 HSE Radar\nНовый пользователь зарегистрирован\n${event.full_name||fullName}\n${event.email||email}`);
    await admin.from("registration_notification_events").update({processed_at:new Date().toISOString()}).eq("user_id",userId).is("processed_at",null);
  }catch(error){console.error("auth.signup.admin_notification_failed",{error:error instanceof Error?error.message:String(error)})}
}
