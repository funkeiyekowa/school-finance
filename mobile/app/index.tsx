import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { getDefaultSchoolSlug } from "@/lib/school-config";

export default function Index() {
  const { identity, loading } = useAuth();
  const [defaultSlug, setDefaultSlug] = useState<string | null>(null);

  useEffect(() => {
    if (identity || loading) return;
    let cancelled = false;
    void getDefaultSchoolSlug().then((slug) => {
      if (!cancelled) setDefaultSlug(slug);
    });
    return () => { cancelled = true; };
  }, [identity, loading]);

  if (loading) return <LoadingScreen />;
  if (identity) return <Redirect href="/(app)/(tabs)" />;
  if (!defaultSlug) return <LoadingScreen />;

  return <Redirect href={{ pathname: "/(auth)/sign-in", params: { slug: defaultSlug } }} />;
}
