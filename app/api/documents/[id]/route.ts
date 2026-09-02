import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
  const { data: document, error } = await supabase.from("documents").select("storage_path,archived_at").eq("id", id).maybeSingle();
  if (error || !document || document.archived_at) return NextResponse.json({ error: "Документ не найден." }, { status: 404 });
  const signed = await supabase.storage.from("hse-documents").createSignedUrl(document.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: signed.error?.message || "Не удалось открыть документ." }, { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
