import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const hash=(value:string)=>createHash("sha256").update(`${process.env.SUPABASE_SERVICE_ROLE_KEY||"hse-radar"}:${value}`).digest("hex");

export async function checkAuthEmailRateLimit(request:NextRequest,email:string,action:"signup"|"recovery"){
  const ip=(request.headers.get("x-forwarded-for")||"unknown").split(",")[0].trim();
  const {data,error}=await createAdminClient().rpc("check_auth_email_rate_limit",{
    p_email_hash:hash(email),p_ip_hash:hash(ip),p_action:action,
  });
  if(error)throw error;
  return Boolean(data);
}
