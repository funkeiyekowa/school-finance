export type PortalRole = "student" | "parent" | "teacher" | "staff" | "admin";

export interface SchoolBrand {
  organizationId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  status: string | null;
}

export interface LoginContext {
  role: PortalRole | null;
  redirect: string | null;
  organization_id: string | null;
  organization_name: string | null;
  student_id: string | null;
}

export interface MobileIdentity {
  userId: string;
  email: string | null;
  fullName: string;
  role: PortalRole;
  school: SchoolBrand;
}

export function roleLabel(role: PortalRole): string {
  if (role === "admin") return "School administrator";
  if (role === "teacher") return "Teacher";
  if (role === "staff") return "Staff";
  return role[0].toUpperCase() + role.slice(1);
}
