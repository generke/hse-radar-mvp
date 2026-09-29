import { NextRequest, NextResponse } from "next/server";
import { checkAuthEmailRateLimit } from "@/lib/auth/email-rate-limit";
import { sendTransactionalEmail } from "@/lib/notifications/server";
import { createAdminClient } from "@/lib/supabase/admin";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;
const success="Если аккаунт существует, ссылка для восстановления отправлена на почту.";

export async function POST(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body=await request.json();
    const email=String(body.email||"").trim().toLowerCase();
    const website=String(body.website||"").trim();
    if(website)return NextResponse.json({ok:true,message:success},{status:202});
    if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return NextResponse.json({error:"Укажите корректный адрес электронной почты."},{status:400});
    if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return NextResponse.json({error:"Сервис писем временно недоступен. Повторите попытку позже."},{status:503});
    if(!await checkAuthEmailRateLimit(request,email,"recovery"))return NextResponse.json({error:"Слишком много попыток. Подождите 10 минут и повторите."},{status:429,headers:{"Retry-After":"600"}});

    const admin=createAdminClient();
    const site=(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin).replace(/\/$/,"");
    const result=await admin.auth.admin.generateLink({type:"recovery",email});
    if(result.error){
      console.warn("auth.recovery.link_rejected",{code:result.error.code,status:result.error.status});
      return NextResponse.json({ok:true,message:success},{status:202});
    }
    const url=`${site}/auth/callback?token_hash=${encodeURIComponent(result.data.properties.hashed_token)}&type=recovery&next=/reset-password`;
    const delivery=await sendTransactionalEmail({to:email,subject:"HSE Radar: восстановление доступа",heading:"Восстановление доступа",body:"Нажмите кнопку, чтобы задать новый пароль. Если вы не запрашивали восстановление, проигнорируйте это письмо.",actionLabel:"Задать новый пароль",actionUrl:url});
    if(!delivery.ok){
      console.error("auth.recovery.delivery_failed",{error:delivery.error,skipped:delivery.skipped});
      return NextResponse.json({error:"Не удалось отправить письмо. Повторите попытку позже."},{status:503});
    }
    return NextResponse.json({ok:true,message:success},{status:202});
  }catch(error){
    console.error("auth.recovery.failed",{error:error instanceof Error?error.message:String(error)});
    return NextResponse.json({error:"Не удалось отправить ссылку восстановления. Повторите попытку."},{status:500});
  }
}
