import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("organizations").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return NextResponse.json({ status: "ok", database: "ok", latencyMs: Date.now() - started, timestamp: new Date().toISOString() });
  } catch (error) {
    const detail=error instanceof Error?error.message:"Unknown database health error";
    console.error("health.database.failed",{
      detail,
      supabaseUrlConfigured:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL),
      serviceRoleConfigured:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    });
    return NextResponse.json({ status: "degraded", database: "error", timestamp: new Date().toISOString() }, { status: 503 });
  }
}
