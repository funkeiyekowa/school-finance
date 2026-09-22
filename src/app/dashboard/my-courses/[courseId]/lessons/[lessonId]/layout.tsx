import type { ReactNode } from "react";
import { StudentAssignments } from "./_components/StudentAssignments";

export default async function LessonLayout({ children, params }: { children: ReactNode; params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  return <>{children}<StudentAssignments lessonId={lessonId} /></>;
}
