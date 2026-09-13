import { createHash,randomBytes } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramBotUsername } from "@/lib/telegram";

export async function POST(request:NextRequest){
 try{
  if(request.headers.get("origin")&&request.headers.get("origin")!==request.nextUrl.origin)return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
  const {organizationId}=await request.json(),supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется авторизация."},{status:401});
  const {data:membership}=await supabase.from("memberships").select("user_id").eq("organization_id",String(organizationId||"")).eq("user_id",user.id).eq("is_active",true).maybeSingle();
  const {data:platformAdmin}=await supabase.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
  if(!membership&&!platformAdmin)return NextResponse.json({error:"Организация недоступна."},{status:403});
  const code=randomBytes(24).toString("base64url"),tokenHash=createHash("sha256").update(code).digest("hex"),admin=createAdminClient();
  const {error}=await admin.from("vision_telegram_pairings").insert({organization_id:String(organizationId),user_id:user.id,code_hash:tokenHash,expires_at:new Date(Date.now()+15*60*1000).toISOString()});
  if(error)throw error;
  return NextResponse.json({url:`https://t.me/${telegramBotUsername}?start=${code}`});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Не удалось создать ссылку Telegram."},{status:500})}
}
