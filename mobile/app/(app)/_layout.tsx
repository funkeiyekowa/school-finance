import { Redirect, Stack } from "expo-router";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";

export default function AppLayout() {
  const { identity, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!identity) return <Redirect href="/(auth)/school" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
