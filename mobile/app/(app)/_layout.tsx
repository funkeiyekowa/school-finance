import { Redirect, Stack } from "expo-router";
import { useState } from "react";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { getDefaultSchoolSlug } from "@/lib/school-config";
import { useEffect } from "react";

export default function AppLayout() {
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
  if (!identity) {
    if (!defaultSlug) return <LoadingScreen />;
    return <Redirect href={{ pathname: "/(auth)/sign-in", params: { slug: defaultSlug } }} />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
