import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/context/AuthContext";
import { configureNotificationHandler } from "@/lib/push-service";

// How a notification behaves while the app is foregrounded. Set once at module
// load, before any notification can arrive.
configureNotificationHandler();

export default function RootLayout() {
  return <AuthProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false }} /></AuthProvider>;
}
