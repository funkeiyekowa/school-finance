import type { Metadata } from "next";
import { fetchSchoolBrand } from "../login/school-info";
import StaffLoginForm from "./StaffLoginForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await fetchSchoolBrand(params.slug);
  return {
    title: `${brand.name} - Staff Portal`,
    description: `Staff sign in for ${brand.name}.`,
    robots: { index: false, follow: false },
  };
}

/**
 * School-scoped staff portal.
 *
 * Same visual language as the legacy /staff-portal (deep navy + gold),
 * but the sign-in is bound to a specific school's slug. resolve_login_context
 * is the source of truth for role — students / parents are rejected, and
 * super-admins are told to use /admin-console.
 */
export default async function SchoolStaffPortalPage({ params }: Props) {
  const brand = await fetchSchoolBrand(params.slug);
  return (
    <StaffLoginForm
      slug={brand.slug || params.slug}
      schoolName={brand.name}
      logoUrl={brand.logo_url}
      found={brand.found}
    />
  );
}
