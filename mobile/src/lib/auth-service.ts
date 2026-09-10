import * as SecureStore from "expo-secure-store";
import { supabase, MOBILE_SCHOOL_SLUG_KEY } from "@/lib/supabase";
import type { LoginContext, MobileIdentity, PortalRole, SchoolBrand } from "@/lib/auth-types";

const STUDENT_CODE_RE = /^[A-Za-z]\d+$/;

function studentAuthEmail(code: string, organizationId: string): string {
  return `${code.trim().toLowerCase()}.${organizationId}@student.local`;
}

function asFirstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeRole(value: unknown): PortalRole | null {
  if (value === "student" || value === "parent" || value === "teacher" || value === "admin" || value === "staff") return value;
  if (value === "owner" || value === "editor" || value === "bursar" || value === "finance") return "admin";
  return null;
}

export async function getSchoolBrand(slug: string): Promise<SchoolBrand> {
  const cleaned = slug.trim().toLowerCase();
  if (!cleaned) throw new Error("Enter your school's address name.");
  const { data, error } = await supabase.rpc("resolve_school_brand_by_slug", { p_slug: cleaned });
  if (error) throw new Error("We could not find that school. Check the address name and try again.");
  const row = asFirstRow(data);
  const organizationId = typeof row?.organization_id === "string" ? row.organization_id : null;
  if (!organizationId) throw new Error("We could not find that school. Check the address name and try again.");
  const status = typeof row?.status === "string" ? row.status : null;
  if (status && status !== "active" && status !== "trial") {
    throw new Error("This school's account is not currently available. Please contact the school.");
  }
  return {
    organizationId,
    name: typeof row?.organization_name === "string" ? row.organization_name : "School",
    slug: typeof row?.organization_slug === "string" ? row.organization_slug : cleaned,
    logoUrl: typeof row?.logo_url === "string" ? row.logo_url : null,
    status
  };
}

export async function signInToSchool(input: { slug: string; identifier: string; password: string }): Promise<MobileIdentity> {
  const brand = await getSchoolBrand(input.slug);
  const rawIdentifier = input.identifier.trim();
  if (!rawIdentifier || !input.password) throw new Error("Enter your email or student code, and your password.");

  let email = rawIdentifier.toLowerCase();
  if (!rawIdentifier.includes("@")) {
    const code = rawIdentifier.toUpperCase();
    if (!STUDENT_CODE_RE.test(code)) throw new Error("Student codes look like S288 (a letter followed by numbers).");
    const { data, error } = await supabase.rpc("verify_student_code", { p_code: code, p_org: brand.organizationId });
    if (error) throw new Error("We could not verify this student code. Please try again.");
    const verified = asFirstRow(data);
    if (verified?.error === "ambiguous") throw new Error("This student code needs attention from your school administrator.");
    if (verified?.exists === false) throw new Error("Student code not found at this school.");
    if (verified?.exists === true && verified.active === false) throw new Error("This student account is not active.");
    email = typeof verified?.login_email === "string" ? verified.login_email : studentAuthEmail(code, brand.organizationId);
  }

  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (signInError || !signIn.user) throw new Error("Sign-in failed. Check your credentials and try again.");

  const { data: contextData, error: contextError } = await supabase.rpc("resolve_login_context", { p_slug: brand.slug });
  const context = asFirstRow(contextData) as unknown as LoginContext | null;
  const role = normalizeRole(context?.role);
  if (contextError || !role || context?.organization_id !== brand.organizationId) {
    await supabase.auth.signOut();
    throw new Error("This account does not have access to this school.");
  }

  await SecureStore.setItemAsync(MOBILE_SCHOOL_SLUG_KEY, brand.slug);
  return loadIdentity(signIn.user.id, brand, role, signIn.user.email ?? null);
}

export async function restoreIdentity(userId: string, email: string | null): Promise<MobileIdentity | null> {
  const slug = await SecureStore.getItemAsync(MOBILE_SCHOOL_SLUG_KEY);
  if (!slug) return null;
  const brand = await getSchoolBrand(slug);
  const { data, error } = await supabase.rpc("resolve_login_context", { p_slug: brand.slug });
  const context = asFirstRow(data) as unknown as LoginContext | null;
  const role = normalizeRole(context?.role);
  if (error || !role || context?.organization_id !== brand.organizationId) return null;
  return loadIdentity(userId, brand, role, email);
}

async function loadIdentity(userId: string, school: SchoolBrand, role: PortalRole, email: string | null): Promise<MobileIdentity> {
  const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  const candidate = data as { full_name?: string | null } | null;
  const fullName = candidate?.full_name?.trim() || (email?.endsWith("@student.local") ? "Student" : email?.split("@")[0] || "School user");
  return { userId, email, fullName, role, school };
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(MOBILE_SCHOOL_SLUG_KEY);
  await supabase.auth.signOut();
}
