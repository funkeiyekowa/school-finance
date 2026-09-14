/**
 * POST /api/notifications/push
 *
 * Server-side push delivery for a single chat message.
 *
 * The mobile client calls this immediately after send_message succeeds, passing
 * its Supabase access token and the new message id. It never receives, and
 * cannot enumerate, anyone's device tokens.
 *
 * Auth chain:
 *   1. Bearer JWT is verified with the service client's auth.getUser(jwt).
 *      A forged or expired token fails here.
 *   2. The caller must be the SENDER of p_message_id. Without this check any
 *      signed-in user could replay arbitrary message ids and spam other
 *      people's devices.
 *   3. Only then does the service client resolve recipients via
 *      push_targets_for_message(), which is granted to service_role ONLY and
 *      already excludes the sender, departed members and muted conversations.
 *
 * The service-role key is read from the server environment and never leaves it.
 */

import { NextRequest, NextResponse } from "next/server";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

interface PushTarget {
  user_id: string;
  expo_push_token: string;
  title: string;
  body: string;
  conversation_id: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) {
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let messageId = "";
  try {
    const payload = (await req.json()) as { messageId?: string };
    messageId = (payload.messageId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!messageId) {
    return NextResponse.json({ error: "missing messageId" }, { status: 400 });
  }

  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const svc = createServiceClient(url, svcKey, { auth: { persistSession: false } });

  // 1. Verify the bearer token belongs to a real user.
  const { data: userData, error: userErr } = await svc.auth.getUser(jwt);
  const caller = userData?.user;
  if (userErr || !caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. The caller must own this message. Prevents replaying arbitrary ids.
  const { data: msgRow } = await svc
    .from("messages")
    .select("id, sender_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  const message = msgRow as { id: string; sender_id: string; deleted_at: string | null } | null;
  if (!message || message.sender_id !== caller.id) {
    // Same response for "not found" and "not yours" — no existence oracle.
    return NextResponse.json({ error: "not authorized for this message" }, { status: 403 });
  }
  if (message.deleted_at) {
    return NextResponse.json({ ok: true, sent: 0, reason: "message deleted" });
  }

  // 3. Resolve recipients server-side.
  const { data: targetRows, error: targetErr } = await svc.rpc("push_targets_for_message", {
    p_message_id: messageId,
  });
  if (targetErr) {
    return NextResponse.json({ error: "could not resolve recipients" }, { status: 500 });
  }

  const targets = (targetRows as PushTarget[]) ?? [];
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const messages = targets.map((t) => ({
    to: t.expo_push_token,
    title: t.title,
    body: t.body,
    sound: "default" as const,
    channelId: "messages",
    data: { conversationId: t.conversation_id, messageId },
  }));

  const invalidTokens: string[] = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += CHUNK) {
    const batch = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent += 1;
          return;
        }
        // Expo tells us when a token is permanently dead; stop retrying it.
        if (ticket.details?.error === "DeviceNotRegistered") {
          const dead = batch[idx]?.to;
          if (dead) invalidTokens.push(dead);
        }
      });
    } catch {
      // A transient Expo outage must not fail the user's message send.
      continue;
    }
  }

  if (invalidTokens.length > 0) {
    await svc.rpc("mark_push_tokens_invalid", { p_tokens: invalidTokens }).then(
      () => {},
      () => {},
    );
  }

  return NextResponse.json({ ok: true, sent, invalidated: invalidTokens.length });
}
