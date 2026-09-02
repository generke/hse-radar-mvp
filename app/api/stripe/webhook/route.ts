import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return NextResponse.json({ error:"Webhook environment is incomplete" }, { status:503 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY); const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error:"Missing signature" }, { status:400 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error:"Invalid signature" }, { status:400 }); }
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from("stripe_events").select("processed_at").eq("event_id",event.id).maybeSingle();
  if (existing?.processed_at) return NextResponse.json({ received:true, duplicate:true });
  const stored = await supabase.from("stripe_events").upsert({ event_id:event.id, event_type:event.type, last_error:null }, { onConflict:"event_id" });
  if (stored.error) return NextResponse.json({ error:"Unable to persist Stripe event" }, { status:500 });

  try {
   if (["checkout.session.completed","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)) {
    const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
    const organizationId = object.metadata?.organization_id || ("client_reference_id" in object ? object.client_reference_id : null);
    if (organizationId) {
      const customerId = typeof object.customer === "string" ? object.customer : null;
      const subscriptionStatus = event.type === "checkout.session.completed"
        ? ((object as Stripe.Checkout.Session).payment_status === "paid" || (object as Stripe.Checkout.Session).payment_status === "no_payment_required" ? "active" : "incomplete")
        : (object as Stripe.Subscription).status;
      const active = ["active","trialing"].includes(subscriptionStatus);
      const updated = await supabase.from("organizations").update({ plan:active?"pro":"trial", subscription_status:subscriptionStatus, stripe_customer_id:customerId }).eq("id",organizationId);
      if (updated.error) return NextResponse.json({ error:"Unable to update subscription" }, { status:500 });
      await supabase.from("billing_events").insert({ organization_id:organizationId, provider:"stripe", external_id:event.id, event_type:event.type, payload:event.data.object });
    }
   }

   if (["invoice.payment_failed","invoice.payment_succeeded"].includes(event.type)) {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
    if (customerId) {
      const { data: organization } = await supabase.from("organizations").select("id").eq("stripe_customer_id",customerId).maybeSingle();
      if (organization) {
        const status = event.type === "invoice.payment_succeeded" ? "active" : "past_due";
        await supabase.from("organizations").update({ subscription_status:status, ...(status === "active" ? { plan:"pro" } : {}) }).eq("id",organization.id);
        const amountPaid = "amount_paid" in invoice ? Number(invoice.amount_paid || 0) : 0;
        await supabase.from("billing_events").insert({ organization_id:organization.id, provider:"stripe", external_id:event.id, event_type:event.type, amount:amountPaid/100, currency:invoice.currency.toUpperCase(), payload:event.data.object });
      }
    }
   }
   const marked = await supabase.from("stripe_events").update({ processed_at:new Date().toISOString(), last_error:null }).eq("event_id",event.id);
   if (marked.error) throw marked.error;
  } catch (error) {
    const message=error instanceof Error?error.message:"Webhook processing failed";
    await supabase.from("stripe_events").update({ last_error:message.slice(0,1000) }).eq("event_id",event.id);
    return NextResponse.json({ error:"Webhook processing failed" }, { status:500 });
  }
  return NextResponse.json({ received:true });
}
