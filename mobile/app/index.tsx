import { Redirect } from "expo-router";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";

export default function Index() {
  const { identity, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return <Redirect href={identity ? "/(app)/(tabs)" : "/(auth)/school"} />;
}
