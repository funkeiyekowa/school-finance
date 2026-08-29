import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  try {
    const { serverAddress, username, password, webhookId } = await request.json();

    if (!serverAddress || !username || !password || !webhookId) {
      return NextResponse.json({ ok: false, error: "Server address, username, password, and webhook ID are required." }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(serverAddress);
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetch(`${baseUrl}/3rdparty/v1/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: `Gateway rejected removal (${res.status}): ${text}` }, { status: 200 });
    }

    return NextResponse.json({ ok: true, message: "Webhook removed." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not reach the gateway server.";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}

function normalizeBaseUrl(serverAddress: string): string {
  let addr = serverAddress.trim();
  if (!/^https?:\/\//i.test(addr)) addr = `https://${addr}`;
  return addr.replace(/\/+$/, "");
}
