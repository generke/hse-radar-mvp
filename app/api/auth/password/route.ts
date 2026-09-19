import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;

export async function PATCH(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
    const body=await request.json();const password=String(body.password||"");
    if(password.length<10)return NextResponse.json({error:"Новый пароль должен содержать минимум 10 символов."},{status:400});
    const admin=createAdminClient();const current=await admin.auth.admin.getUserById(user.id);if(current.error)throw current.error;
    const appMetadata={...(current.data.user.app_metadata||{}),must_change_password:false};
    const updated=await admin.auth.admin.updateUserById(user.id,{password,app_metadata:appMetadata});if(updated.error)throw updated.error;
    return NextResponse.json({ok:true});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось изменить пароль."},{status:500})}
}
