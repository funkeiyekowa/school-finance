"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, BookOpen, FileText, Save, Trash2 } from "lucide-react";

interface SubjectRow { id: string; name: string; short_code: string; }
interface ClassRow { id: string; name: string; }
interface QuestionRow { id: string; question_text: string; question_type: string; difficulty: string; marks: number; subject_id: string | null; topic: string | null; options: unknown; }
interface ExamRow { id: string; title: string; exam_type: string; status: string; duration_minutes: number; total_marks: number; class_id: string | null; subject_id: string | null; created_at: string; }
interface ExamQuestionRow { id: string; exam_id: string; question_id: string; sort_order: number; }

export default function CbtPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"questions" | "exams">("exams");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);

  // Question form
  const [showQForm, setShowQForm] = useState(false);
  const [savingQ, setSavingQ] = useState(false);
  const [qForm, setQForm] = useState({
    question_text: "", question_type: "multiple_choice", subject_id: "", topic: "", difficulty: "medium", marks: "1",
    options: [{ id: "A", text: "", is_correct: true }, { id: "B", text: "", is_correct: false }, { id: "C", text: "", is_correct: false }, { id: "D", text: "", is_correct: false }],
  });

  // Exam form
  const [showExamForm, setShowExamForm] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [examForm, setExamForm] = useState({
    title: "", exam_type: "exam", subject_id: "", class_id: "", duration_minutes: "60", max_attempts: "1",
    shuffle_questions: false, shuffle_options: false, show_results: true,
  });

  // Exam question assignment
  const [selectedExam, setSelectedExam] = useState<ExamRow | null>(null);
  const [examQuestions, setExamQuestions] = useState<ExamQuestionRow[]>([]);

  const load = useCallback(async () => {
    const [subRes, clsRes, qRes, exRes] = await Promise.all([
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("questions").select("*").eq("active", true).order("created_at", { ascending: false }),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
    ]);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setQuestions(qRes.data as QuestionRow[] ?? []);
    setExams(exRes.data as ExamRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function saveQuestion() {
    setSavingQ(true);
    await supabase.from("questions").insert({
      question_text: qForm.question_text.trim(),
      question_type: qForm.question_type,
      subject_id: qForm.subject_id || null,
      topic: qForm.topic.trim() || null,
      difficulty: qForm.difficulty,
      marks: parseFloat(qForm.marks) || 1,
      options: qForm.options,
      correct_answer: qForm.question_type === "true_false" ? qForm.options.find(o => o.is_correct)?.text : null,
      organization_id: orgId,
      created_by: profile?.full_name || profile?.email,
    });
    setSavingQ(false);
    setShowQForm(false);
    setQForm({ question_text: "", question_type: "multiple_choice", subject_id: "", topic: "", difficulty: "medium", marks: "1", options: [{ id: "A", text: "", is_correct: true }, { id: "B", text: "", is_correct: false }, { id: "C", text: "", is_correct: false }, { id: "D", text: "", is_correct: false }] });
    load();
  }

  async function saveExam() {
    setSavingExam(true);
    await supabase.from("exams").insert({
      title: examForm.title.trim(),
      exam_type: examForm.exam_type,
      subject_id: examForm.subject_id || null,
      class_id: examForm.class_id || null,
      duration_minutes: parseInt(examForm.duration_minutes) || 60,
      max_attempts: parseInt(examForm.max_attempts) || 1,
      shuffle_questions: examForm.shuffle_questions,
      shuffle_options: examForm.shuffle_options,
      show_results: examForm.show_results,
      status: "draft",
      organization_id: orgId,
      created_by: profile?.full_name || profile?.email,
    });
    setSavingExam(false);
    setShowExamForm(false);
    setExamForm({ title: "", exam_type: "exam", subject_id: "", class_id: "", duration_minutes: "60", max_attempts: "1", shuffle_questions: false, shuffle_options: false, show_results: true });
    load();
  }

  async function openExamQuestions(exam: ExamRow) {
    setSelectedExam(exam);
    const { data } = await supabase.from("exam_questions").select("*").eq("exam_id", exam.id).order("sort_order");
    setExamQuestions(data as ExamQuestionRow[] ?? []);
  }

  async function addQuestionToExam(questionId: string) {
    if (!selectedExam) return;
    const nextOrder = examQuestions.length + 1;
    await supabase.from("exam_questions").insert({ exam_id: selectedExam.id, question_id: questionId, sort_order: nextOrder });
    // Update total_marks
    const q = questions.find(q => q.id === questionId);
    if (q) {
      await supabase.from("exams").update({ total_marks: (selectedExam.total_marks || 0) + q.marks, updated_at: new Date().toISOString() }).eq("id", selectedExam.id);
    }
    openExamQuestions(selectedExam);
    load();
  }

  async function removeQuestionFromExam(eqId: string, questionId: string) {
    if (!selectedExam) return;
    await supabase.from("exam_questions").delete().eq("id", eqId);
    const q = questions.find(q => q.id === questionId);
    if (q) {
      await supabase.from("exams").update({ total_marks: Math.max(0, (selectedExam.total_marks || 0) - q.marks), updated_at: new Date().toISOString() }).eq("id", selectedExam.id);
    }
    openExamQuestions(selectedExam);
    load();
  }

  async function publishExam(examId: string) {
    await supabase.from("exams").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", examId);
    load();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="CBT / Online Exams" subtitle="Manage question bank, create exams, and monitor attempts" />

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("exams")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "exams" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          <FileText size={14} /> Exams ({exams.length})
        </button>
        <button onClick={() => setTab("questions")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "questions" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          <BookOpen size={14} /> Question Bank ({questions.length})
        </button>
      </div>

      {/* EXAMS TAB */}
      {tab === "exams" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Exams</CardTitle>
              {canEdit && <Button size="sm" variant="gold" onClick={() => setShowExamForm(true)}><Plus size={14} /> Create Exam</Button>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Title</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Subject</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Duration</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Marks</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {exams.map(exam => (
                    <tr key={exam.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{exam.title}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs uppercase">{exam.exam_type}</td>
                      <td className="px-3 py-2 text-gray-500">{subjects.find(s => s.id === exam.subject_id)?.name || "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{exam.duration_minutes} min</td>
                      <td className="px-3 py-2 text-gray-500">{exam.total_marks}</td>
                      <td className="px-3 py-2">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          exam.status === "published" ? "bg-green-100 text-green-700" :
                          exam.status === "draft" ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-500"
                        )}>{exam.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right space-x-2">
                        <button onClick={() => openExamQuestions(exam)} className="text-xs text-[#0F2A47] hover:underline">Questions</button>
                        {exam.status === "draft" && canEdit && (
                          <button onClick={() => publishExam(exam.id)} className="text-xs text-green-700 hover:underline">Publish</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {exams.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No exams created yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* QUESTIONS TAB */}
      {tab === "questions" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Question Bank</CardTitle>
              {canEdit && <Button size="sm" variant="gold" onClick={() => setShowQForm(true)}><Plus size={14} /> Add Question</Button>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {questions.map((q, i) => (
                <div key={q.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 line-clamp-2">{q.question_text}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                      <span className={cn("px-1.5 py-0.5 rounded font-bold uppercase",
                        q.difficulty === "easy" ? "bg-green-50 text-green-600" :
                        q.difficulty === "hard" ? "bg-red-50 text-red-600" :
                        "bg-amber-50 text-amber-600"
                      )}>{q.difficulty}</span>
                      <span>{q.question_type.replace("_", " ")}</span>
                      <span>{q.marks} mark{q.marks !== 1 ? "s" : ""}</span>
                      {q.topic && <span>· {q.topic}</span>}
                    </div>
                  </div>
                  {selectedExam && !examQuestions.find(eq => eq.question_id === q.id) && (
                    <Button size="sm" variant="secondary" onClick={() => addQuestionToExam(q.id)}>+ Add</Button>
                  )}
                </div>
              ))}
              {questions.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">No questions in the bank yet.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exam Questions Panel */}
      {selectedExam && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Questions in: {selectedExam.title} ({examQuestions.length})</CardTitle>
              <button onClick={() => setSelectedExam(null)} className="text-xs text-gray-500 hover:underline">Close</button>
            </div>
          </CardHeader>
          <CardContent>
            {examQuestions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No questions added. Go to the Question Bank tab and click &ldquo;+ Add&rdquo; to assign questions.</p>
            ) : (
              <div className="space-y-1">
                {examQuestions.map((eq, i) => {
                  const q = questions.find(q => q.id === eq.question_id);
                  return (
                    <div key={eq.id} className="flex items-center gap-3 p-2 border rounded hover:bg-gray-50">
                      <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
                      <span className="flex-1 text-sm text-gray-800 truncate">{q?.question_text || "?"}</span>
                      <span className="text-xs text-gray-400">{q?.marks}mk</span>
                      <button onClick={() => removeQuestionFromExam(eq.id, eq.question_id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ADD QUESTION MODAL */}
      {showQForm && (
        <Modal open onClose={() => setShowQForm(false)} title="Add Question" size="lg">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question</label>
              <textarea rows={3} value={qForm.question_text} onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder="Enter the question text..." />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={qForm.question_type} onChange={e => setQForm(f => ({ ...f, question_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="multiple_choice">Multiple Choice</option>
                  <option value="true_false">True / False</option>
                  <option value="short_answer">Short Answer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <select value={qForm.subject_id} onChange={e => setQForm(f => ({ ...f, subject_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Any</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                <select value={qForm.difficulty} onChange={e => setQForm(f => ({ ...f, difficulty: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
              <Input label="Marks" type="number" value={qForm.marks} onChange={e => setQForm(f => ({ ...f, marks: e.target.value }))} min="0.5" step="0.5" />
            </div>
            <Input label="Topic (optional)" value={qForm.topic} onChange={e => setQForm(f => ({ ...f, topic: e.target.value }))} placeholder="Algebra" />

            {/* Options for MCQ */}
            {(qForm.question_type === "multiple_choice" || qForm.question_type === "true_false") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Options (select the correct answer)</label>
                <div className="space-y-2">
                  {qForm.options.map((opt, i) => (
                    <div key={opt.id} className="flex items-center gap-2">
                      <input type="radio" name="correct" checked={opt.is_correct}
                        onChange={() => setQForm(f => ({ ...f, options: f.options.map((o, j) => ({ ...o, is_correct: j === i })) }))}
                        className="w-4 h-4 text-[#C9A227] focus:ring-[#C9A227]" />
                      <span className="text-sm font-bold text-gray-500 w-5">{opt.id}.</span>
                      <input type="text" value={opt.text} placeholder={`Option ${opt.id}`}
                        onChange={e => setQForm(f => ({ ...f, options: f.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) }))}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#C9A227]" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowQForm(false)}>Cancel</Button>
              <Button variant="gold" loading={savingQ} onClick={saveQuestion} disabled={!qForm.question_text.trim()}>
                <Save size={14} /> Save Question
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* CREATE EXAM MODAL */}
      {showExamForm && (
        <Modal open onClose={() => setShowExamForm(false)} title="Create Exam" size="md">
          <div className="space-y-4">
            <Input label="Exam Title" value={examForm.title} onChange={e => setExamForm(f => ({ ...f, title: e.target.value }))} placeholder="Mathematics Mid-Term Test" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={examForm.exam_type} onChange={e => setExamForm(f => ({ ...f, exam_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="exam">Exam</option>
                  <option value="test">Test</option>
                  <option value="quiz">Quiz</option>
                  <option value="assignment">Assignment</option>
                  <option value="practice">Practice</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <select value={examForm.subject_id} onChange={e => setExamForm(f => ({ ...f, subject_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Any</option>
                  {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
                <select value={examForm.class_id} onChange={e => setExamForm(f => ({ ...f, class_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Any</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Input label="Duration (min)" type="number" value={examForm.duration_minutes} onChange={e => setExamForm(f => ({ ...f, duration_minutes: e.target.value }))} />
              <Input label="Max Attempts" type="number" value={examForm.max_attempts} onChange={e => setExamForm(f => ({ ...f, max_attempts: e.target.value }))} />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={examForm.shuffle_questions} onChange={e => setExamForm(f => ({ ...f, shuffle_questions: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />
                Shuffle questions
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={examForm.shuffle_options} onChange={e => setExamForm(f => ({ ...f, shuffle_options: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />
                Shuffle options
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={examForm.show_results} onChange={e => setExamForm(f => ({ ...f, show_results: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />
                Show results after submit
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowExamForm(false)}>Cancel</Button>
              <Button variant="gold" loading={savingExam} onClick={saveExam} disabled={!examForm.title.trim()}>
                <Save size={14} /> Create
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
