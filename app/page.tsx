import { AuthScreen } from "@/components/auth-screen";
import { Dashboard } from "@/components/dashboard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  const configured = Boolean(supabaseUrl && supabaseKey);
  if (!configured) return <Dashboard demo />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <AuthScreen supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} />;
  const { data: membership } = await supabase.from("memberships").select("organization_id, role, organizations(name, plan, subscription_status)").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return <Dashboard demo userEmail={user.email} configurationError="Профиль создан, но организация не найдена. Примените supabase/schema.sql." />;
  const organizationId = membership.organization_id;
  const [employees, inventory, ppe, documents] = await Promise.all([
    supabase.from("employees").select("*").eq("organization_id", organizationId).order("full_name"),
    supabase.from("inventory").select("*").eq("organization_id", organizationId).order("name"),
    supabase.from("ppe_issues").select("*").eq("organization_id", organizationId).order("replacement_date"),
    supabase.from("documents").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);
  const org = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
  return <Dashboard supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} userEmail={user.email} organizationId={organizationId} organizationName={org?.name || "Моя организация"} role={membership.role} plan={org?.plan || "trial"} initialData={{ employees: employees.data || [], inventory: inventory.data || [], ppe: ppe.data || [], documents: documents.data || [] }} />;
}
