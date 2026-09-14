import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRole, normalizePermissions } from "@/lib/access";

const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;

async function authorize(organizationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const [{ data: membership }, { data: platformAdmin }] = await Promise.all([
    supabase.from("memberships").select("role,is_active").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle(),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if ((membership?.role !== "owner" || membership.is_active===false) && !platformAdmin) return { error: NextResponse.json({ error: "Только активный владелец может управлять командой." }, { status: 403 }) };
  return { user };
}

export async function POST(request: NextRequest) {
  try {
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body = await request.json();
    const organizationId = String(body.organizationId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "member");
    const sectionPermissions = normalizePermissions(role,body.sectionPermissions);
    if (!organizationId || !/^\S+@\S+\.\S+$/.test(email) || !isRole(role)) return NextResponse.json({ error: "Проверьте email и роль." }, { status: 400 });
    const auth = await authorize(organizationId); if (auth.error) return auth.error;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("invite_member_by_email", { org_id:organizationId, invite_email:email, invite_role:role, invite_permissions:sectionPermissions });
    if (error) throw error;
    const result=(data||{}) as {existing?:boolean;token?:string;user_id?:string;full_name?:string;email?:string};
    const site = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
    const inviteUrl=result.token?`${site}/?invitation=${encodeURIComponent(result.token)}&email=${encodeURIComponent(email)}`:null;
    return NextResponse.json({ ok:true, invited:!result.existing, inviteUrl, member:result.existing?{user_id:result.user_id,role,section_permissions:sectionPermissions,is_active:true,created_at:new Date().toISOString(),full_name:result.full_name,email:result.email}:null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось пригласить пользователя." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body = await request.json();
    const organizationId = String(body.organizationId || "");
    const userId = String(body.userId || "");
    const role = String(body.role || "");
    const sectionPermissions = normalizePermissions(role,body.sectionPermissions);
    if (!organizationId || !userId || !isRole(role)) return NextResponse.json({ error: "Некорректные данные." }, { status: 400 });
    const auth = await authorize(organizationId); if (auth.error) return auth.error;
    const supabase = await createClient();
    const { error } = await supabase.from("memberships").update({ role, section_permissions:sectionPermissions }).eq("organization_id", organizationId).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить роль." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const organizationId = request.nextUrl.searchParams.get("organizationId") || "";
    const userId = request.nextUrl.searchParams.get("userId") || "";
    if (!organizationId || !userId) return NextResponse.json({ error: "Некорректные данные." }, { status: 400 });
    const auth = await authorize(organizationId); if (auth.error) return auth.error;
    if (auth.user?.id === userId) return NextResponse.json({ error: "Нельзя удалить собственный доступ." }, { status: 400 });
    const supabase = await createClient();
    const { data: member } = await supabase.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
    if (member?.role === "owner") {
      const { count } = await supabase.from("memberships").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("role", "owner");
      if ((count || 0) <= 1) return NextResponse.json({ error: "В организации должен остаться хотя бы один владелец." }, { status: 400 });
    }
    const { error } = await supabase.from("memberships").delete().eq("organization_id", organizationId).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить участника." }, { status: 500 });
  }
}
