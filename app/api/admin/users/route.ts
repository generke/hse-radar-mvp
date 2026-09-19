import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRole, normalizePermissions } from "@/lib/access";
import { sendTransactionalEmail } from "@/lib/notifications/server";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;
async function authorize(){const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return {error:NextResponse.json({error:"Требуется авторизация."},{status:401})};const {data:admin}=await supabase.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();if(!admin)return {error:NextResponse.json({error:"Доступ разрешён только администратору платформы."},{status:403})};return {user}}

export async function POST(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const access=await authorize();if(access.error)return access.error;
    const body=await request.json();
    const organizationId=String(body.organizationId||"");
    const email=String(body.email||"").trim().toLowerCase();
    const fullName=String(body.fullName||"").trim();
    const role=String(body.role||"member");
    const permissions=normalizePermissions(role,body.sectionPermissions);
    if(!organizationId||!/^\S+@\S+\.\S+$/.test(email)||!fullName||!isRole(role))return NextResponse.json({error:"Проверьте организацию, имя, почту и роль."},{status:400});
    const admin=createAdminClient();
    const {data:profile}=await admin.from("profiles").select("id,email,full_name").ilike("email",email).maybeSingle();
    let userId=profile?.id as string|undefined;
    let temporaryPassword:string|undefined;
    if(!userId){
      temporaryPassword=`${randomBytes(15).toString("base64url")}!Aa7`;
      const created=await admin.auth.admin.createUser({email,password:temporaryPassword,email_confirm:true,user_metadata:{full_name:fullName},app_metadata:{created_by_admin:true,must_change_password:true}});
      if(created.error)throw created.error;
      userId=created.data.user.id;
    }
    const {error:membershipError}=await admin.from("memberships").upsert({organization_id:organizationId,user_id:userId,role,section_permissions:permissions,is_active:true},{onConflict:"organization_id,user_id"});
    if(membershipError)throw membershipError;
    const {data:organization}=await admin.from("organizations").select("name").eq("id",organizationId).single();
    const site=(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin).replace(/\/$/,"");
    const emailResult=await sendTransactionalEmail({to:email,subject:temporaryPassword?"Доступ к HSE Radar":"Вам открыт доступ к HSE Radar",heading:temporaryPassword?"Ваш аккаунт создан":"Доступ к организации открыт",body:temporaryPassword?`Организация: ${organization?.name||"HSE Radar"}. Временный пароль: ${temporaryPassword}. После первого входа система потребует задать новый пароль.`:`Вам открыт доступ к организации ${organization?.name||"HSE Radar"}. Используйте свой текущий пароль.`,actionLabel:"Войти в HSE Radar",actionUrl:site});
    return NextResponse.json({ok:true,emailSent:emailResult.ok,temporaryPassword:emailResult.ok?undefined:temporaryPassword,member:{organization_id:organizationId,organization_name:organization?.name||organizationId,user_id:userId,full_name:profile?.full_name||fullName,email,role,is_active:true,created_at:new Date().toISOString()}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось создать пользователя."},{status:500})}
}

export async function DELETE(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const access=await authorize();if(access.error)return access.error;
    const userId=request.nextUrl.searchParams.get("userId")||"";
    if(!userId)return NextResponse.json({error:"Не указан пользователь."},{status:400});
    if(userId===access.user?.id)return NextResponse.json({error:"Нельзя удалить собственный аккаунт."},{status:400});
    const admin=createAdminClient();
    const {data:protectedAdmin}=await admin.from("platform_admins").select("user_id").eq("user_id",userId).maybeSingle();
    if(protectedAdmin)return NextResponse.json({error:"Другого администратора платформы нельзя удалить через интерфейс."},{status:400});
    const {error:membershipError}=await admin.from("memberships").delete().eq("user_id",userId);if(membershipError)throw membershipError;
    const {error}=await admin.auth.admin.deleteUser(userId,true);if(error)throw error;
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось удалить пользователя."},{status:500})}
}
