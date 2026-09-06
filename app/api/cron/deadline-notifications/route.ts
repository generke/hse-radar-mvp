import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic="force-dynamic";
export const maxDuration=60;

type Deadline={label:string;title:string;date:string};
const esc=(value:unknown)=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]!));
const TIME_ZONE="Asia/Almaty";
function almatyDate(){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const part=(type:string)=>parts.find(p=>p.type===type)?.value;return `${part("year")}-${part("month")}-${part("day")}`}
function displayDate(value:string){return new Intl.DateTimeFormat("ru-RU",{timeZone:TIME_ZONE,day:"2-digit",month:"long",year:"numeric"}).format(new Date(`${value}T00:00:00+05:00`))}

export async function GET(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
  const resendKey=process.env.RESEND_API_KEY;const emailFrom=process.env.EMAIL_FROM;
  if(!resendKey||!emailFrom)return NextResponse.json({error:"Email provider is not configured"},{status:503});
  const supabase=createAdminClient();const today=almatyDate();
  const {data:organizations,error:orgError}=await supabase.from("organizations").select("id,name");
  if(orgError)return NextResponse.json({error:orgError.message},{status:500});
  let sent=0;let failed=0;let organizationsWithDeadlines=0;
  for(const org of organizations||[]){
    const [tasks,employees,inventory,ppe,documents,assignments]=await Promise.all([
      supabase.from("tasks").select("id,title,due_date").eq("organization_id",org.id).eq("due_date",today).is("archived_at",null).not("status","in",'(done,verified)'),
      supabase.from("employees").select("full_name,medical_exam_expiry,briefing_expiry,training_expiry").eq("organization_id",org.id).is("archived_at",null).or(`medical_exam_expiry.eq.${today},briefing_expiry.eq.${today},training_expiry.eq.${today}`),
      supabase.from("inventory").select("name,next_service_date").eq("organization_id",org.id).eq("next_service_date",today).is("archived_at",null),
      supabase.from("ppe_issues").select("employee_name,item_name,replacement_date").eq("organization_id",org.id).eq("replacement_date",today).is("archived_at",null),
      supabase.from("documents").select("name,expires_at").eq("organization_id",org.id).eq("expires_at",today).is("archived_at",null),
      supabase.from("learning_assignments").select("due_date,employees(full_name),learning_courses(title)").eq("organization_id",org.id).eq("due_date",today).not("status","in",'(passed)'),
    ]);
    const deadlines:Deadline[]=[];
    for(const item of tasks.data||[])deadlines.push({label:"Задача",title:item.title,date:item.due_date});
    for(const item of employees.data||[]){if(item.medical_exam_expiry===today)deadlines.push({label:"Медосмотр",title:item.full_name,date:today});if(item.briefing_expiry===today)deadlines.push({label:"Инструктаж",title:item.full_name,date:today});if(item.training_expiry===today)deadlines.push({label:"Обучение",title:item.full_name,date:today})}
    for(const item of inventory.data||[])deadlines.push({label:"Обслуживание",title:item.name,date:item.next_service_date});
    for(const item of ppe.data||[])deadlines.push({label:"Замена СИЗ",title:`${item.item_name} · ${item.employee_name}`,date:item.replacement_date});
    for(const item of documents.data||[])deadlines.push({label:"Документ",title:item.name,date:item.expires_at});
    for(const item of assignments.data||[]){const employee=Array.isArray(item.employees)?item.employees[0]:item.employees;const course=Array.isArray(item.learning_courses)?item.learning_courses[0]:item.learning_courses;deadlines.push({label:"Обучение",title:`${course?.title||"Программа"} · ${employee?.full_name||"Работник"}`,date:item.due_date})}
    if(!deadlines.length)continue;organizationsWithDeadlines++;
    const {data:memberships,error:membershipError}=await supabase.from("memberships").select("user_id").eq("organization_id",org.id).eq("is_active",true);
    if(membershipError){failed++;console.error(`Recipient query failed for organization ${org.id}:`,membershipError.message);continue}
    for(const member of memberships||[]){
      const {data:already}=await supabase.from("notification_deliveries").select("id").eq("organization_id",org.id).eq("recipient_user_id",member.user_id).eq("notification_date",today).eq("status","sent").maybeSingle();
      if(already)continue;
      const {data:userData}=await supabase.auth.admin.getUserById(member.user_id);const email=userData.user?.email;if(!email)continue;
      const rows=deadlines.map(item=>`<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb;color:#667085">${esc(item.label)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:600">${esc(item.title)}</td><td style="padding:10px;border-bottom:1px solid #e5e7eb">${esc(displayDate(item.date))}</td></tr>`).join("");
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${resendKey}`,"content-type":"application/json"},body:JSON.stringify({from:emailFrom,to:[email],subject:`HSE Radar: сегодня истекают сроки (${deadlines.length})`,html:`<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#101828"><p style="color:#16a36a;font-weight:700">HSE RADAR</p><h1 style="font-size:25px">Сегодня последний день до просрочки</h1><p>Организация: <strong>${esc(org.name)}</strong>. Указанный срок наступает сегодня — закройте задачу или измените дату до конца дня.</p><table style="width:100%;border-collapse:collapse;margin:24px 0"><thead><tr><th align="left">Тип</th><th align="left">Объект</th><th align="left">Срок</th></tr></thead><tbody>${rows}</tbody></table><p><a href="${esc(process.env.NEXT_PUBLIC_SITE_URL||"")}" style="display:inline-block;padding:12px 18px;background:#0a1220;color:#fff;text-decoration:none;border-radius:9px">Открыть HSE Radar</a></p><p style="color:#98a2b3;font-size:12px">Автоматическое уведомление отправлено в 08:00 по времени Алматы.</p></div>`})});
      const body=await response.json().catch(()=>({})) as {id?:string;message?:string};const ok=response.ok;
      await supabase.from("notification_deliveries").upsert({organization_id:org.id,recipient_user_id:member.user_id,recipient_email:email,notification_date:today,provider:"resend",provider_message_id:body.id||null,status:ok?"sent":"failed",error_message:ok?null:body.message||`HTTP ${response.status}`},{onConflict:"organization_id,recipient_user_id,notification_date"});
      if(ok)sent++;else failed++;
    }
  }
  return NextResponse.json({timeZone:TIME_ZONE,date:today,organizations:organizationsWithDeadlines,sent,failed});
}
