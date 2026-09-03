import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request:NextRequest){
  const courseId=request.nextUrl.searchParams.get("courseId");
  if(!courseId)return NextResponse.json({error:"Не указана программа"},{status:400});
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется вход"},{status:401});
  const {data:course,error:courseError}=await supabase.from("learning_courses").select("id,title,organization_id,is_active").eq("id",courseId).single();
  if(courseError||!course?.is_active)return NextResponse.json({error:"Программа недоступна"},{status:404});
  const {data,error}=await supabase.from("learning_questions").select("id,question,options").eq("course_id",courseId).order("created_at");
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({questions:data||[]});
}

export async function POST(request:NextRequest){
  const body=await request.json().catch(()=>null) as {courseId?:string;answers?:Record<string,number>}|null;
  if(!body?.courseId||!body.answers)return NextResponse.json({error:"Некорректные ответы"},{status:400});
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Требуется вход"},{status:401});
  const {data:course,error:courseError}=await supabase.from("learning_courses").select("id,organization_id,passing_score,is_active").eq("id",body.courseId).single();
  if(courseError||!course?.is_active)return NextResponse.json({error:"Программа недоступна"},{status:404});
  const {data:questions,error}=await supabase.from("learning_questions").select("id,correct_option").eq("course_id",body.courseId);
  if(error||!questions?.length)return NextResponse.json({error:error?.message||"В тесте нет вопросов"},{status:400});
  const correct=questions.filter(q=>Number(body.answers?.[q.id])===q.correct_option).length;
  const score=Math.round(correct/questions.length*100); const passed=score>=course.passing_score;
  const result=await supabase.from("learning_attempts").insert({organization_id:course.organization_id,course_id:course.id,taken_by:user.id,score,passed,answers:body.answers}).select("id,course_id,score,passed,completed_at").single();
  if(result.error)return NextResponse.json({error:result.error.message},{status:400});
  return NextResponse.json({score,passed,attempt:result.data});
}
