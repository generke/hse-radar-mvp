import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request:NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return NextResponse.json({ error: "Stripe не настроен: добавьте STRIPE_SECRET_KEY и STRIPE_PRICE_ID." }, { status: 503 });
    const origin=request.headers.get("origin");
    if(origin&&origin!==request.nextUrl.origin)return NextResponse.json({error:"Недопустимый источник запроса."},{status:403});
    const {organizationId}=await request.json() as {organizationId?:string};
    if(!organizationId)return NextResponse.json({error:"Организация не выбрана."},{status:400});
    const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Требуется авторизация." }, { status: 401 });
    const { data: member } = await supabase.from("memberships").select("organization_id, role").eq("user_id", user.id).eq("organization_id",organizationId).maybeSingle();
    if (!member || member.role !== "owner") return NextResponse.json({ error: "Оплату может изменять только владелец организации." }, { status: 403 });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({ mode:"subscription", customer_email:user.email, line_items:[{ price:process.env.STRIPE_PRICE_ID, quantity:1 }], success_url:`${base}/?org=${member.organization_id}&payment=success`, cancel_url:`${base}/?org=${member.organization_id}&payment=cancelled`, client_reference_id:member.organization_id, metadata:{ organization_id:member.organization_id }, subscription_data:{ metadata:{ organization_id:member.organization_id } } });
    return NextResponse.json({ url: session.url });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe checkout failed" }, { status: 500 }); }
}
