import { AuthScreen } from "@/components/auth-screen";
import { Dashboard, type AdminAccessUser, type Tab } from "@/components/dashboard";
import type { AuditEvent, TaskItem, TeamMember } from "@/components/product-panels";
import type { LearningAssignment, LearningAttempt, LearningCourse, VisionCamera, VisionEvent } from "@/components/module-panels";
import type { JobProfile } from "@/components/positions-panel";
import type { UserNotification } from "@/components/notification-center";
import { normalizePermissions, sectionKeys, type SectionKey } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id:string; role:string; created_at:string; section_permissions?:SectionKey[];is_active?:boolean;
  organizations:{ id:string; name:string; plan:string; subscription_status:string; subscription_expires_at?:string|null } | { id:string; name:string; plan:string; subscription_status:string; subscription_expires_at?:string|null }[] | null;
};
type SearchParams={org?:string;section?:string;invitation?:string};
type ProfileRow={id:string;full_name?:string|null;email?:string|null};
const related=<T,>(value:T|T[]|null):T|undefined=>Array.isArray(value)?value[0]:value||undefined;
const empty=()=>Promise.resolve({data:[],error:null});

export default async function Home({searchParams}:{searchParams:Promise<SearchParams>}) {
  const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||"";
  const supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||"";
  if(!supabaseUrl||!supabaseKey)return <Dashboard demo/>;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return <AuthScreen supabaseUrl={supabaseUrl} supabaseKey={supabaseKey}/>;
  const params=await searchParams;
  const [{data:platformAdmin},{data:membershipData}]=await Promise.all([
    supabase.from("platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
    supabase.from("memberships").select("organization_id,role,created_at,section_permissions,is_active,organizations(id,name,plan,subscription_status,subscription_expires_at)").eq("user_id",user.id).order("created_at"),
  ]);
  const isPlatformAdmin=Boolean(platformAdmin);
  const memberships=(membershipData||[]) as MembershipRow[];
  const {data:allOrganizations}=isPlatformAdmin
    ?await supabase.from("organizations").select("id,name,plan,subscription_status,subscription_expires_at,created_at").order("name")
    :{data:[]};
  const workspaces=isPlatformAdmin
    ?(allOrganizations||[]).map(org=>({id:org.id,name:org.name,role:"platform_admin",plan:org.plan,subscription_status:org.subscription_status,section_permissions:[...sectionKeys]}))
    :memberships.filter(item=>item.is_active!==false).map(item=>{const org=related(item.organizations);return{id:item.organization_id,name:org?.name||"Организация",role:item.role,plan:org?.plan||"free",subscription_status:org?.subscription_status||"free",section_permissions:normalizePermissions(item.role,item.section_permissions)}});
  const selected=workspaces.find(org=>org.id===params.org)||workspaces[0];
  if(!selected)return <Dashboard demo userEmail={user.email} configurationError="Профиль создан, но рабочее пространство не найдено. Обратитесь к администратору."/>;

  const membership=memberships.find(item=>item.organization_id===selected.id);
  const role=isPlatformAdmin?"platform_admin":membership?.role||"member";
  const permissions=isPlatformAdmin||role==="owner"?[...sectionKeys]:normalizePermissions(role,membership?.section_permissions);
  const requested=params.section as Tab|undefined;
  const activeSection:Tab=requested==="admin"&&isPlatformAdmin?"admin":requested&&sectionKeys.includes(requested as SectionKey)&&permissions.includes(requested as SectionKey)?requested:"overview";
  const overview=activeSection==="overview";
  const needEmployees=overview||["employees","tmc","learning","billing"].includes(activeSection);
  const needMembers=overview||["tasks","team","audit","admin"].includes(activeSection);
  const needLearning=overview||activeSection==="learning";
  const needVision=overview||activeSection==="vision";
  const needPayments=["billing","admin"].includes(activeSection);

  const [employees,inventory,ppe,documents,tasks,members,audit,paymentRequests,adminOrganizations,courses,questions,attempts,assignments,cameras,visionEvents,jobProfiles,notifications,trainingTypes,documentCategories]=await Promise.all([
    needEmployees?supabase.from("employees").select("*").eq("organization_id",selected.id).is("archived_at",null).order("full_name"):empty(),
    overview||activeSection==="tmc"||activeSection==="billing"?supabase.from("inventory").select("*").eq("organization_id",selected.id).is("archived_at",null).order("name"):empty(),
    overview||activeSection==="tmc"||activeSection==="billing"?supabase.from("ppe_issues").select("*").eq("organization_id",selected.id).is("archived_at",null).order("replacement_date"):empty(),
    overview||activeSection==="documents"||activeSection==="billing"?supabase.from("documents").select("*").eq("organization_id",selected.id).is("archived_at",null).order("created_at",{ascending:false}):empty(),
    overview||activeSection==="tasks"?supabase.from("tasks").select("*").eq("organization_id",selected.id).is("archived_at",null).order("due_date"):empty(),
    needMembers?supabase.from("memberships").select("organization_id,user_id,role,section_permissions,is_active,created_at").eq("organization_id",selected.id).order("created_at"):empty(),
    activeSection==="audit"?supabase.from("audit_events").select("*").eq("organization_id",selected.id).order("created_at",{ascending:false}).limit(200):empty(),
    needPayments?supabase.from("payment_requests").select("id,organization_id,payment_reference,status,created_at,amount,billing_months,organizations(name,plan,subscription_status)").order("created_at",{ascending:false}).limit(isPlatformAdmin?100:10):empty(),
    activeSection==="admin"&&isPlatformAdmin?supabase.from("organizations").select("id,name,plan,subscription_status,subscription_expires_at,created_at").order("created_at",{ascending:false}):empty(),
    needLearning?supabase.from("learning_courses").select("*").eq("organization_id",selected.id).order("created_at",{ascending:false}):empty(),
    activeSection==="learning"?supabase.from("learning_questions").select("course_id").eq("organization_id",selected.id):empty(),
    activeSection==="learning"?supabase.from("learning_attempts").select("id,course_id,score,passed,completed_at").eq("organization_id",selected.id).order("completed_at",{ascending:false}).limit(30):empty(),
    needLearning?supabase.from("learning_assignments").select("id,course_id,employee_id,due_date,status,score,completed_at,employees(full_name,department),learning_courses(title,course_type)").eq("organization_id",selected.id).order("due_date"):empty(),
    needVision?supabase.from("vision_cameras").select("id,name,location,stream_url,status,zone_points,created_at").eq("organization_id",selected.id).order("created_at",{ascending:false}):empty(),
    needVision?supabase.from("vision_events").select("id,camera_id,event_type,status,confidence,notes,task_id,occurred_at").eq("organization_id",selected.id).order("occurred_at",{ascending:false}).limit(50):empty(),
    ["employees","positions"].includes(activeSection)?supabase.from("job_profiles").select("id,title,required_fields,required_training_codes,custom_training_name,custom_training_names").eq("organization_id",selected.id).order("title"):empty(),
    supabase.from("user_notifications").select("id,title,body,severity,read_at,created_at").eq("organization_id",selected.id).eq("user_id",user.id).order("created_at",{ascending:false}).limit(30),
    activeSection==="learning"?supabase.from("training_types").select("id,name,format,is_active").eq("organization_id",selected.id).order("name"):empty(),
    activeSection==="documents"?supabase.from("document_categories").select("id,name,is_active").eq("organization_id",selected.id).order("name"):empty(),
  ]);

  const memberRows=(members.data||[]) as TeamMember[];
  const userIds=[...new Set(memberRows.map(item=>item.user_id))];
  const {data:profiles}=userIds.length?await supabase.from("profiles").select("id,full_name,email").in("id",userIds):{data:[]};
  const profileMap=new Map(((profiles||[]) as ProfileRow[]).map(profile=>[profile.id,profile]));
  const team=memberRows.map(item=>({...item,full_name:profileMap.get(item.user_id)?.full_name||null,email:profileMap.get(item.user_id)?.email||null}));

  let adminAccessUsers:AdminAccessUser[]=[];
  if(activeSection==="admin"&&isPlatformAdmin){
    const{data:accessRows}=await supabase.from("memberships").select("organization_id,user_id,role,is_active,created_at").order("created_at",{ascending:false});
    const ids=[...new Set((accessRows||[]).map(item=>item.user_id))];
    const{data:accessProfiles}=ids.length?await supabase.from("profiles").select("id,full_name,email").in("id",ids):{data:[]};
    const accessMap=new Map(((accessProfiles||[]) as ProfileRow[]).map(item=>[item.id,item])),orgMap=new Map((allOrganizations||[]).map(item=>[item.id,item.name]));
    adminAccessUsers=(accessRows||[]).map(item=>{const profile=accessMap.get(item.user_id);return{...item,organization_name:orgMap.get(item.organization_id)||item.organization_id,full_name:profile?.full_name,email:profile?.email}}) as AdminAccessUser[];
  }
  const questionCounts=new Map<string,number>();for(const question of questions.data||[])questionCounts.set(question.course_id,(questionCounts.get(question.course_id)||0)+1);
  const learningCourses=(courses.data||[]).map(course=>({...course,question_count:questionCounts.get(course.id)||0})) as LearningCourse[];
  const learningAssignments=(assignments.data||[]).map(item=>{const employee=related(item.employees);const course=related(item.learning_courses);return{id:item.id,course_id:item.course_id,employee_id:item.employee_id,due_date:item.due_date,status:item.status,score:item.score,completed_at:item.completed_at,employee_name:employee?.full_name,department:employee?.department,course_title:course?.title,course_type:course?.course_type}}) as LearningAssignment[];

  return <Dashboard key={`${selected.id}:${activeSection}`} initialTab={activeSection} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} userEmail={user.email} userId={user.id}
    organizationId={selected.id} organizationName={selected.name} role={role} plan={selected.plan}
    isPlatformAdmin={isPlatformAdmin} workspaces={workspaces} sectionPermissions={permissions}
    kaspiPayUrl={process.env.NEXT_PUBLIC_KASPI_PAY_URL||""}
    paymentRequests={paymentRequests.data||[]} adminOrganizations={adminOrganizations.data||[]} adminAccessUsers={adminAccessUsers}
    tasks={(tasks.data||[]) as TaskItem[]} members={team} auditEvents={(audit.data||[]) as AuditEvent[]}
    learningCourses={learningCourses} learningAttempts={(attempts.data||[]) as LearningAttempt[]} learningAssignments={learningAssignments}
    visionCameras={(cameras.data||[]) as VisionCamera[]} visionEvents={(visionEvents.data||[]) as VisionEvent[]}
    jobProfiles={(jobProfiles.data||[]) as JobProfile[]} notifications={(notifications.data||[]) as UserNotification[]}
    trainingTypes={trainingTypes.data||[]} documentCategories={documentCategories.data||[]}
    initialData={{employees:employees.data||[],inventory:inventory.data||[],ppe:ppe.data||[],documents:documents.data||[]}}/>;
}
