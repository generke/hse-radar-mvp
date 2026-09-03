import { AuthScreen } from "@/components/auth-screen";
import { Dashboard } from "@/components/dashboard";
import type { AuditEvent, TaskItem, TeamMember } from "@/components/product-panels";
import type { LearningAttempt, LearningCourse, VisionCamera, VisionEvent } from "@/components/module-panels";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id:string; role:string; created_at:string;
  organizations:{ id:string; name:string; plan:string; subscription_status:string; subscription_expires_at?:string|null } | { id:string; name:string; plan:string; subscription_status:string; subscription_expires_at?:string|null }[] | null;
};
const related=<T,>(value:T|T[]|null):T|undefined=>Array.isArray(value)?value[0]:value||undefined;

export default async function Home({searchParams}:{searchParams:Promise<{org?:string}>}) {
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||"";
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"";
  if(!supabaseUrl||!supabaseKey)return <Dashboard demo/>;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return <AuthScreen supabaseUrl={supabaseUrl} supabaseKey={supabaseKey}/>;
  const params=await searchParams;
  const [{data:platformAdmin},{data:membershipData}]=await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
    supabase.from("memberships").select("organization_id,role,created_at,organizations(id,name,plan,subscription_status,subscription_expires_at)").eq("user_id",user.id).order("created_at"),
  ]);
  const isPlatformAdmin=Boolean(platformAdmin);
  const memberships=(membershipData||[]) as MembershipRow[];
  const {data:allOrganizations}=isPlatformAdmin?await supabase.from("organizations").select("id,name,plan,subscription_status,subscription_expires_at,created_at").order("name"):{data:[]};
  const workspaces=isPlatformAdmin
    ?(allOrganizations||[]).map(org=>({id:org.id,name:org.name,role:"platform_admin",plan:org.plan,subscription_status:org.subscription_status}))
    :memberships.map(item=>{const org=related(item.organizations);return{id:item.organization_id,name:org?.name||"Организация",role:item.role,plan:org?.plan||"free",subscription_status:org?.subscription_status||"free"}});
  const selected=workspaces.find(org=>org.id===params.org)||workspaces[0];
  if(!selected)return <Dashboard demo userEmail={user.email} configurationError="Профиль создан, но рабочее пространство не найдено. Обратитесь к администратору."/>;
  const membership=memberships.find(item=>item.organization_id===selected.id);
  const role=isPlatformAdmin?"platform_admin":membership?.role||"member";
  const [employees,inventory,ppe,documents,tasks,members,audit,paymentRequests,adminOrganizations,courses,questions,attempts,cameras,visionEvents]=await Promise.all([
    supabase.from("employees").select("*").eq("organization_id",selected.id).is("archived_at",null).order("full_name"),
    supabase.from("inventory").select("*").eq("organization_id",selected.id).is("archived_at",null).order("name"),
    supabase.from("ppe_issues").select("*").eq("organization_id",selected.id).is("archived_at",null).order("replacement_date"),
    supabase.from("documents").select("*").eq("organization_id",selected.id).is("archived_at",null).order("created_at",{ascending:false}),
    supabase.from("tasks").select("*").eq("organization_id",selected.id).is("archived_at",null).order("due_date"),
    supabase.from("memberships").select("user_id,role,created_at").eq("organization_id",selected.id).order("created_at"),
    supabase.from("audit_events").select("*").eq("organization_id",selected.id).order("created_at",{ascending:false}).limit(200),
    supabase.from("payment_requests").select("id,organization_id,payment_reference,status,created_at,amount,billing_months,organizations(name,plan,subscription_status)").order("created_at",{ascending:false}).limit(isPlatformAdmin?100:10),
    isPlatformAdmin?supabase.from("organizations").select("id,name,plan,subscription_status,subscription_expires_at,created_at").order("created_at",{ascending:false}):Promise.resolve({data:[]}),
    supabase.from("learning_courses").select("id,title,course_type,description,passing_score,is_active,created_at").eq("organization_id",selected.id).order("created_at",{ascending:false}),
    supabase.from("learning_questions").select("course_id").eq("organization_id",selected.id),
    supabase.from("learning_attempts").select("id,course_id,score,passed,completed_at").eq("organization_id",selected.id).order("completed_at",{ascending:false}).limit(30),
    supabase.from("vision_cameras").select("id,name,location,status,zone_points,created_at").eq("organization_id",selected.id).order("created_at",{ascending:false}),
    supabase.from("vision_events").select("id,camera_id,event_type,status,confidence,occurred_at").eq("organization_id",selected.id).order("occurred_at",{ascending:false}).limit(50),
  ]);
  const memberRows=(members.data||[]) as TeamMember[];
  const userIds=memberRows.map(item=>item.user_id);
  const {data:profiles}=userIds.length?await supabase.from("profiles").select("id,full_name").in("id",userIds):{data:[]};
  const names=new Map((profiles||[]).map(profile=>[profile.id,profile.full_name]));
  const team=memberRows.map(item=>({...item,full_name:names.get(item.user_id)||null}));
  const questionCounts=new Map<string,number>();for(const question of questions.data||[])questionCounts.set(question.course_id,(questionCounts.get(question.course_id)||0)+1);
  const learningCourses=(courses.data||[]).map(course=>({...course,question_count:questionCounts.get(course.id)||0})) as LearningCourse[];
  return <Dashboard supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} userEmail={user.email}
    organizationId={selected.id} organizationName={selected.name} role={role} plan={selected.plan}
    isPlatformAdmin={isPlatformAdmin} workspaces={workspaces}
    kaspiPayUrl={process.env.NEXT_PUBLIC_KASPI_PAY_URL||""}
    paymentRequests={paymentRequests.data||[]} adminOrganizations={adminOrganizations.data||[]}
    tasks={(tasks.data||[]) as TaskItem[]} members={team} auditEvents={(audit.data||[]) as AuditEvent[]}
    learningCourses={learningCourses} learningAttempts={(attempts.data||[]) as LearningAttempt[]}
    visionCameras={(cameras.data||[]) as VisionCamera[]} visionEvents={(visionEvents.data||[]) as VisionEvent[]}
    initialData={{employees:employees.data||[],inventory:inventory.data||[],ppe:ppe.data||[],documents:documents.data||[]}}/>;
}
