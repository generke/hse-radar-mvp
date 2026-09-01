import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error:"Webhook environment is incomplete" }, { status:503 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error:"Missing signature" }, { status:400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error:"Invalid signature" }, { status:400 }); }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{ persistSession:false } });
  if (["checkout.session.completed","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)) {
    const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
    const organizationId = object.metadata?.organization_id || ("client_reference_id" in object ? object.client_reference_id : null);
    if (organizationId) { const active = event.type !== "customer.subscription.deleted"; await supabase.from("organizations").update({ plan:active?"pro":"trial", subscription_status:active?"active":"cancelled", stripe_customer_id: typeof object.customer === "string" ? object.customer : null }).eq("id",organizationId); }
  }
  return NextResponse.json({ received:true });
}
