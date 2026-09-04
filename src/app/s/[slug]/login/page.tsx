import type { Metadata } from "next";
import { fetchSchoolBrand } from "./school-info";
import SchoolLoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = await fetchSchoolBrand(slug);
  return {
    title: `${brand.name} - Sign In`,
    description: `Sign in to your ${brand.name} portal.`,
    robots: { index: false, follow: false },
  };
}

export default async function SchoolScopedLoginPage({ params }: Props) {
  const { slug } = await params;
  const brand = await fetchSchoolBrand(slug);
  return (
    <SchoolLoginForm
      slug={brand.slug || slug}
      organizationId={brand.organization_id}
      schoolName={brand.name}
      logoUrl={brand.logo_url}
      found={brand.found}
      status={brand.status ?? null}
    />
  );
}
