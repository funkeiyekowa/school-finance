import { Redirect, Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { LoadingScreen } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { getDefaultSchoolSlug } from "@/lib/school-config";
import {
  addNotificationListeners,
  getInitialNotificationData,
  registerForPush,
  type NotificationTapData,
} from "@/lib/push-service";

/**
 * Routes a tapped notification to the right screen. Message pushes (no
 * `type`) keep opening the conversation exactly as before; attendance and
 * exam event-pushes (from /api/notifications/push-event) open the
 * corresponding parent tab instead — there is no per-record detail screen
 * for either yet, so the tab itself is the destination.
 */
function routeForNotification(router: ReturnType<typeof useRouter>, data: NotificationTapData): void {
  if (data.conversationId) {
    router.push({
      pathname: "/(app)/chat/[conversationId]",
      params: { conversationId: data.conversationId },
    } as never);
    return;
  }
  if (data.type === "attendance") {
    router.push("/(app)/(tabs)/my-attendance" as never);
    return;
  }
  if (data.type === "exam") {
    router.push("/(app)/(tabs)/exams" as never);
  }
}

export default function AppLayout() {
  const { identity, loading } = useAuth();
  const router = useRouter();
  const [defaultSlug, setDefaultSlug] = useState<string | null>(null);
  const coldStartHandled = useRef(false);

  useEffect(() => {
    if (identity || loading) return;
    let cancelled = false;
    void getDefaultSchoolSlug().then((slug) => {
      if (!cancelled) setDefaultSlug(slug);
    });
    return () => { cancelled = true; };
  }, [identity, loading]);

  // Register this device for push once signed in. Failure is silent by design:
  // push is an enhancement, and a missing EAS projectId or a denied permission
  // must never block the portal.
  useEffect(() => {
    if (!identity) return;
    void registerForPush();
  }, [identity]);

  // Tapping a notification opens the conversation, attendance tab, or exams
  // tab it relates to, and a rotated push token re-registers itself.
  useEffect(() => {
    if (!identity) return;
    return addNotificationListeners((data) => routeForNotification(router, data));
  }, [identity, router]);

  // A cold launch from a notification does not fire the response listener, so
  // the deep link has to be read once on start or it is lost.
  useEffect(() => {
    if (!identity || coldStartHandled.current) return;
    coldStartHandled.current = true;
    void getInitialNotificationData().then((data) => {
      if (data) routeForNotification(router, data);
    });
  }, [identity, router]);

  if (loading) return <LoadingScreen />;
  if (!identity) {
    if (!defaultSlug) return <LoadingScreen />;
    return <Redirect href={{ pathname: "/(auth)/sign-in", params: { slug: defaultSlug } }} />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
