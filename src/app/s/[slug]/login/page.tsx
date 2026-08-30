import type { Metadata } from "next";
import { fetchSchoolBrand } from "./school-info";
import SchoolLoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await fetchSchoolBrand(params.slug);
  return {
    title: `${brand.name} - Sign In`,
    description: `Sign in to your ${brand.name} portal.`,
    robots: { index: false, follow: false },
  };
}

export default async function SchoolScopedLoginPage({ params }: Props) {
  const brand = await fetchSchoolBrand(params.slug);
  return (
    <SchoolLoginForm
      slug={brand.slug || params.slug}
      schoolName={brand.name}
      logoUrl={brand.logo_url}
      found={brand.found}
      status={brand.status ?? null}
    />
  );
}
