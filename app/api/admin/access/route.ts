import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;

export async function PATCH(request:NextRequest){
  try{
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
    const{data:admin}=await supabase.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
    if(!admin)return NextResponse.json({error:"Требуются права Platform Admin."},{status:403});
    const body=await request.json(),organizationId=String(body.organizationId||""),userId=String(body.userId||""),active=body.active;
    if(!organizationId||!userId||typeof active!=="boolean")return NextResponse.json({error:"Некорректные данные."},{status:400});
    const db=createAdminClient(),{data:membership,error}=await db.from("memberships").update({is_active:active}).eq("organization_id",organizationId).eq("user_id",userId).select("organization_id,user_id,is_active").single();
    if(error)throw error;
    return NextResponse.json({ok:true,membership});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось изменить доступ."},{status:500})}
}
