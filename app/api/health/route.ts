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
  } catch {
    return NextResponse.json({ status: "degraded", database: "error", timestamp: new Date().toISOString() }, { status: 503 });
  }
}
