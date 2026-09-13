import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";

/** Last token minted on this device, so sign-out can revoke it after a restart. */
const PUSH_TOKEN_KEY = "smart_thrive.mobile.push_token";

/**
 * Push notifications — mobile side.
 *
 * The device token is registered through register_push_token(), which resolves
 * organization_id server-side from current_user_org_id(). No organization_id is
 * ever sent from here, and this app never holds a service-role key: delivery is
 * performed by the web app's /api/notifications/push route, which is the only
 * thing that can read anyone's token.
 *
 * Prerequisites that CANNOT be satisfied in code:
 *   - An EAS projectId in app.json (extra.eas.projectId). Without it,
 *     getExpoPushTokenAsync() cannot mint a token.
 *   - A development build. Expo Go no longer delivers remote push on either
 *     platform, so testing push inside Expo Go will always fail.
 * Both are reported through PushSetupState rather than thrown, so a missing
 * prerequisite degrades to "push off" instead of breaking sign-in.
 */

export type PushSetupState =
  | { status: "registered"; token: string }
  | { status: "denied" }
  | { status: "unsupported"; reason: string };

/** Foreground presentation. Safe to call at module load. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function resolveProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.trim()) return fromExtra.trim();
  const legacy = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return null;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Messages",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  // Matches the channelId values /api/notifications/push-event sends for
  // attendance and exam event-pushes.
  await Notifications.setNotificationChannelAsync("attendance", {
    name: "Attendance",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync("exams", {
    name: "Exams",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Requests permission, mints an Expo push token and registers it against the
 * signed-in user. Returns a state rather than throwing — push is an
 * enhancement and must never block the app.
 */
export async function registerForPush(): Promise<PushSetupState> {
  if (!Device.isDevice) {
    return { status: "unsupported", reason: "Push notifications need a physical device." };
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    return {
      status: "unsupported",
      reason: "No EAS projectId configured in app.json — push cannot be enabled yet.",
    };
  }

  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return { status: "denied" };

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    if (!token) return { status: "unsupported", reason: "Could not obtain a push token." };

    const { data, error } = await supabase.rpc("register_push_token", {
      p_token: token,
      p_platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
      p_device_name: Device.deviceName ?? null,
    });
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || res.ok !== true) {
      return { status: "unsupported", reason: res.reason ?? "Could not register this device." };
    }

    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    return { status: "registered", token };
  } catch (e) {
    return { status: "unsupported", reason: e instanceof Error ? e.message : "Push setup failed." };
  }
}

/**
 * Called on sign-out so a shared device stops receiving the old user's alerts.
 * Must run BEFORE supabase.auth.signOut(), because revoke_push_token() is
 * scoped to auth.uid() and does nothing once the session is gone.
 */
export async function revokePushForThisDevice(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (!token) return;
    await supabase.rpc("revoke_push_token", { p_token: token });
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  } catch {
    // Best effort. register_push_token() also reassigns the row to whoever
    // signs in next, so a missed revoke cannot leak to the new user.
  }
}

/**
 * Asks the web app to deliver push for a message the caller just sent.
 * The access token proves who we are; the route independently verifies that
 * this user is the message's sender before resolving any recipients.
 */
export async function requestPushForMessage(messageId: string): Promise<void> {
  const base = process.env.EXPO_PUBLIC_WEB_APP_URL;
  if (!base) return;
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;

    await fetch(`${base.replace(/\/$/, "")}/api/notifications/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messageId }),
    });
  } catch {
    // Delivery is best-effort; the message itself is already saved.
  }
}

/**
 * Notification payload shapes. `type` distinguishes the event-push
 * notifications (attendance/exam, sent by /api/notifications/push-event)
 * from the original message push, which carries no `type` field —
 * treated as "message" by absence for backward compatibility with
 * already-delivered/queued notifications.
 */
export interface NotificationTapData {
  conversationId?: string;
  messageId?: string;
  type?: "attendance" | "exam";
  classId?: string;
  examId?: string;
  studentId?: string;
}

export type NotificationTapHandler = (data: NotificationTapData) => void;

function readData(content: Notifications.NotificationContent): NotificationTapData {
  return (content.data ?? {}) as NotificationTapData;
}

/**
 * Wires tap-to-open (from background AND from a cold launch) and token
 * rotation. Returns an unsubscribe function.
 *
 * Expo can rotate a device's push token at any time — after an app update, a
 * restore, or an FCM/APNs refresh. Without re-registering, the row in
 * push_device_tokens silently points at a dead address and the user simply
 * stops receiving notifications with no error anywhere.
 */
export function addNotificationListeners(onTap: NotificationTapHandler): () => void {
  const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
    onTap(readData(response.notification.request.content));
  });

  const tokenSub = Notifications.addPushTokenListener((token) => {
    const next = typeof token.data === "string" ? token.data : null;
    if (!next) return;
    void (async () => {
      try {
        await supabase.rpc("register_push_token", {
          p_token: next,
          p_platform: Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "unknown",
          p_device_name: Device.deviceName ?? null,
        });
        await SecureStore.setItemAsync(PUSH_TOKEN_KEY, next);
      } catch {
        // Re-registration is retried on next launch by registerForPush().
      }
    })();
  });

  return () => {
    tapSub.remove();
    tokenSub.remove();
  };
}

/**
 * The notification that launched the app from a cold start, if any.
 * addNotificationResponseReceivedListener does not fire for this case, so it
 * must be read once explicitly or the deep link is lost.
 */
export async function getInitialNotificationData(): Promise<NotificationTapData | null> {
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (!last) return null;
    return readData(last.notification.request.content);
  } catch {
    return null;
  }
}

/** Clears the iOS app-icon badge. Called when the user opens Messages. */
export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Unsupported on some platforms; never surface.
  }
}
