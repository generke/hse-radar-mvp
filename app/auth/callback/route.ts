import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code");
  const requested=request.nextUrl.searchParams.get("next")||"/";
  const next=requested.startsWith("/")&&!requested.startsWith("//")?requested:"/";
  if(!code)return NextResponse.redirect(new URL("/?auth_error=missing_code",request.url));
  const supabase=await createClient();const{error}=await supabase.auth.exchangeCodeForSession(code);
  if(error)return NextResponse.redirect(new URL("/?auth_error=invalid_link",request.url));
  return NextResponse.redirect(new URL(next,request.url));
}
