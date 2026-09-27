import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code");
  const tokenHash=request.nextUrl.searchParams.get("token_hash");
  const type=request.nextUrl.searchParams.get("type") as EmailOtpType|null;
  const requested=request.nextUrl.searchParams.get("next")||"/";
  const next=requested.startsWith("/")&&!requested.startsWith("//")?requested:"/";
  const supabase=await createClient();
  const{error}=code
    ?await supabase.auth.exchangeCodeForSession(code)
    :tokenHash&&type
      ?await supabase.auth.verifyOtp({token_hash:tokenHash,type})
      :{error:new Error("Missing authentication token")};
  if(error)return NextResponse.redirect(new URL("/?auth_error=invalid_link",request.url));
  return NextResponse.redirect(new URL(next,request.url));
}
