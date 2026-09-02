import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const roles = new Set(["owner", "hse", "manager", "hr", "member"]);
const sameOrigin=(request:NextRequest)=>!request.headers.get("origin")||request.headers.get("origin")===request.nextUrl.origin;

async function authorize(organizationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Требуется авторизация." }, { status: 401 }) };
  const [{ data: membership }, { data: platformAdmin }] = await Promise.all([
    supabase.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle(),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (membership?.role !== "owner" && !platformAdmin) return { error: NextResponse.json({ error: "Только владелец может управлять командой." }, { status: 403 }) };
  return { user };
}

export async function POST(request: NextRequest) {
  try {
    if(!sameOrigin(request))return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const body = await request.json();
    const organizationId = String(body.organizationId || "");
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "member");
    if (!organizationId || !/^\S+@\S+\.\S+$/.test(email) || !roles.has(role)) return NextResponse.json({ error: "Проверьте email и роль." }, { status: 400 });
    const auth = await authorize(organizationId); if (auth.error) return auth.error;
    const admin = createAdminClient();
    const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;
    let target = users.users.find(item => item.email?.toLowerCase() === email);
    let invited = false;
    if (!target) {
      const site = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
      const result = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: site, data: { full_name: email.split("@")[0] } });
      if (result.error) throw result.error;
      target = result.data.user;
      invited = true;
    }
    if (!target) throw new Error("Не удалось создать приглашение.");
    const { error } = await admin.from("memberships").upsert({ organization_id: organizationId, user_id: target.id, role }, { onConflict: "organization_id,user_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true, invited });
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
    if (!organizationId || !userId || !roles.has(role)) return NextResponse.json({ error: "Некорректные данные." }, { status: 400 });
    const auth = await authorize(organizationId); if (auth.error) return auth.error;
    const admin = createAdminClient();
    const { error } = await admin.from("memberships").update({ role }).eq("organization_id", organizationId).eq("user_id", userId);
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
    const admin = createAdminClient();
    const { data: member } = await admin.from("memberships").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle();
    if (member?.role === "owner") {
      const { count } = await admin.from("memberships").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).eq("role", "owner");
      if ((count || 0) <= 1) return NextResponse.json({ error: "В организации должен остаться хотя бы один владелец." }, { status: 400 });
    }
    const { error } = await admin.from("memberships").delete().eq("organization_id", organizationId).eq("user_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось удалить участника." }, { status: 500 });
  }
}
