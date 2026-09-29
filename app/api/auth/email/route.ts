import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/notifications/server";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const genericSuccess="Если адрес указан верно, письмо уже отправлено. Проверьте также папку «Спам».";
const sameOrigin=(request:NextRequest)=>{
  const origin=request.headers.get("origin");
  if(!origin)return true;
  try{return new URL(origin).host===request.headers.get("host")}catch{return false}
};
const hash=(value:string)=>createHash("sha256").update(`${process.env.SUPABASE_SERVICE_ROLE_KEY||"hse-radar"}:${value}`).digest("hex");
const clientIp=(request:NextRequest)=>(request.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim();

export async function GET(){
  return NextResponse.json({configured:Boolean(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM)});
}

export async function POST(request:NextRequest){
  let createdUserId:string|undefined;
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body=await request.json();
    const action=body.action==="recovery"?"recovery":"signup";
    const email=String(body.email||"").trim().toLowerCase();
    const fullName=String(body.fullName||"").trim();
    const password=String(body.password||"");
    const website=String(body.website||"").trim();
    if(website)return NextResponse.json({ok:true,message:genericSuccess},{status:202});
    if(!EMAIL.test(email)||email.length>254)return NextResponse.json({error:"Укажите корректный адрес электронной почты."},{status:400});
    if(action==="signup"&&(fullName.length<2||fullName.length>120))return NextResponse.json({error:"Укажите имя длиной от 2 до 120 символов."},{status:400});
    if(action==="signup"&&(password.length<8||password.length>128))return NextResponse.json({error:"Пароль должен содержать от 8 до 128 символов."},{status:400});
    if(!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM){
      console.error("[auth/email] transactional email provider is not configured");
      return NextResponse.json({error:"Сервис писем временно недоступен. Повторите попытку позже."},{status:503});
    }

    const admin=createAdminClient();
    const {data:allowed,error:limitError}=await admin.rpc("check_auth_email_rate_limit",{
      p_email_hash:hash(email),p_ip_hash:hash(clientIp(request)),p_action:action,
    });
    if(limitError)throw limitError;
    if(!allowed)return NextResponse.json({error:"Слишком много попыток. Подождите 10 минут и повторите."},{status:429,headers:{"Retry-After":"600"}});

    const site=(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin).replace(/\/$/,"");
    if(action==="recovery"){
      const {data,error}=await admin.auth.admin.generateLink({type:"recovery",email,options:{redirectTo:`${site}/auth/callback?next=/reset-password`}});
      if(error){
        console.warn("[auth/email] recovery link was not generated",{code:error.code,status:error.status});
        return NextResponse.json({ok:true,message:genericSuccess},{status:202});
      }
      const sent=await sendTransactionalEmail({to:email,subject:"HSE Radar: восстановление доступа",heading:"Восстановление доступа",body:"Нажмите кнопку, чтобы задать новый пароль. Если вы не запрашивали восстановление, просто проигнорируйте это письмо.",actionLabel:"Задать новый пароль",actionUrl:data.properties.action_link});
      if(!sent.ok)throw new Error(`EMAIL_DELIVERY_FAILED:${sent.error||"unknown"}`);
      return NextResponse.json({ok:true,message:genericSuccess},{status:202});
    }

    let link=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:{full_name:fullName},redirectTo:`${site}/auth/callback?next=/`}});
    if(link.error&&/already|registered|exists/i.test(link.error.message)){
      link=await admin.auth.admin.generateLink({type:"magiclink",email,options:{redirectTo:`${site}/auth/callback?next=/`}});
    }else if(!link.error){createdUserId=link.data.user.id}
    if(link.error)throw link.error;
    const sent=await sendTransactionalEmail({to:email,subject:"HSE Radar: подтвердите регистрацию",heading:"Подтвердите адрес электронной почты",body:"Нажмите кнопку, чтобы подтвердить адрес и открыть HSE Radar. Ссылка одноразовая.",actionLabel:"Подтвердить и войти",actionUrl:link.data.properties.action_link});
    if(!sent.ok)throw new Error(`EMAIL_DELIVERY_FAILED:${sent.error||"unknown"}`);
    return NextResponse.json({ok:true,message:genericSuccess,userId:link.data.user.id},{status:202});
  }catch(error){
    if(createdUserId){
      try{await createAdminClient().auth.admin.deleteUser(createdUserId)}catch(cleanupError){console.error("[auth/email] user cleanup failed",cleanupError)}
    }
    console.error("[auth/email] request failed",error);
    const unavailable=error instanceof Error&&error.message.startsWith("EMAIL_DELIVERY_FAILED:");
    return NextResponse.json({error:unavailable?"Не удалось отправить письмо. Повторите попытку позже.":"Не удалось выполнить регистрацию. Повторите попытку."},{status:unavailable?503:500});
  }
}
