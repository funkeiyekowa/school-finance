import type { ReactNode } from "react";
import { StudentAssignments } from "./_components/StudentAssignments";
export default async function Layout({children,params}:{children:ReactNode;params:Promise<{lessonId:string}>}){const{lessonId}=await params;return <>{children}<StudentAssignments lessonId={lessonId}/></>;}
