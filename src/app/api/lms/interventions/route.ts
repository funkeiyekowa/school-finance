import{NextResponse}from"next/server";import{requireStaffSessionWithOrg}from"@/lib/api/requireStaff";import{createClient}from"@/lib/supabase/server";
export async function GET(){const{guard,organizationId}=await requireStaffSessionWithOrg();if(guard)return guard;const s=await createClient();const[{data:c,error:ce},{data:e,error:ee},{data:i,error:ie}]=await Promise.all([s.from("lms_courses").select("id,title").eq("organization_id",organizationId).order("title"),s.from("lms_enrollments").select("course_id,student_id").eq("organization_id",organizationId).eq("status","active").limit(2000),s.from("lms_student_interventions").select("id,course_id,student_id,assignment_id,category,priority,reason,action_plan,status,owner_id,due_date,family_visible,resolution,updated_at").eq("organization_id",organizationId).order("updated_at",{ascending:false}).limit(1000)]);if(ce||ee||ie)return NextResponse.json({error:"Interventions could not be loaded."},{status:500});const ids=[...new Set((e||[]).map(x=>x.student_id))];const{data:students}=ids.length?await s.from("students").select("id,full_name,student_code,grade").eq("organization_id",organizationId).in("id",ids):{data:[]};return NextResponse.json({courses:c||[],enrollments:e||[],students:students||[],interventions:i||[]});}

async function notifyInterventionFamily(s: Awaited<ReturnType<typeof createClient>>, organizationId: string, studentId: string, detail: string): Promise<number> {
  const [{ data: student }, { data: links }] = await Promise.all([
    s.from("students").select("full_name,profile_id").eq("id", studentId).eq("organization_id", organizationId).maybeSingle(),
    s.from("parent_student_links").select("parent_id").eq("student_id", studentId).eq("organization_id", organizationId),
  ]);
  const parentIds = [...new Set((links ?? []).map((link: { parent_id: string }) => link.parent_id))];
  const { data: parents } = parentIds.length
    ? await s.from("parent_profiles").select("profile_id").eq("organization_id", organizationId).in("id", parentIds)
    : { data: [] };
  const recipients = [...new Set([
    student?.profile_id,
    ...(parents ?? []).map((parent: { profile_id: string | null }) => parent.profile_id),
  ].filter((id): id is string => Boolean(id)))];
  let notified = 0;
  for (const recipient of recipients) {
    try {
      const { data: conversationId, error: conversationError } = await s.rpc("create_direct_conversation", {
        p_other: recipient, p_context_student_id: studentId,
      });
      if (conversationError || !conversationId) continue;
      const { error: messageError } = await s.rpc("send_message", {
        p_conversation_id: conversationId, p_body: detail, p_message_type: "text",
        p_reply_to_id: null, p_attachments: null,
      });
      if (!messageError) notified += 1;
    } catch {
      // Notification delivery is best-effort and must not roll back the intervention.
    }
  }
  return notified;
}

export async function POST(r:Request){const{guard}=await requireStaffSessionWithOrg();if(guard)return guard;let b:Record<string,unknown>;try{b=await r.json();}catch{return NextResponse.json({error:"JSON required."},{status:400});}const s=await createClient();const{data,error}=await s.rpc("phase2_save_student_intervention",{p_intervention_id:b.interventionId||null,p_course_id:b.courseId,p_student_id:b.studentId,p_assignment_id:b.assignmentId||null,p_category:b.category,p_priority:b.priority,p_reason:b.reason,p_action_plan:b.actionPlan||null,p_status:b.status,p_owner_id:null,p_due_date:b.dueDate||null,p_family_visible:!!b.familyVisible,p_resolution:b.resolution||null});if(error)return NextResponse.json({error:error.message},{status:400});
const detail = `Student intervention update\n\n${String(b.category||"Support")} · ${String(b.priority||"medium")} · ${String(b.status||"open")}\n${String(b.reason||"")}${b.actionPlan?`\n\nAction plan: ${String(b.actionPlan)}`:""}${b.dueDate?`\n\nDue: ${String(b.dueDate)}`:""}`;
const notified = b.familyVisible ? await notifyInterventionFamily(s, organizationId, String(b.studentId), detail) : 0;
return NextResponse.json({ok:true,interventionId:data,notified});}
