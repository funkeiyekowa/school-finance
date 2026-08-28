/**
 * Back-compat redirect: the old combined /auth/login has been split into
 * three purpose-built entry points. Everyone lands on the student/parent
 * page by default; staff go to /staff-portal (stealth), platform admins
 * go to /admin-console (stealth).
 */
import { redirect } from "next/navigation";

export default function OldLoginRedirect() {
  redirect("/login");
}
