import type { ReactNode } from "react";
import { Student360Header } from "./_components/Student360Header";

export default async function StudentRecordLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <Student360Header studentId={id} />
      {children}
    </>
  );
}
