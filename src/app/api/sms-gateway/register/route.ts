import { NextResponse } from "next/server";

// Registers our webhook endpoint with the school's SMS Gate account using
// the credentials they entered in Setup > SMS Gateway (never hardcoded).
export async function POST(request: Request) {
  try {
    const { serverAddress, username, password, webhookUrl, deviceId } = await request.json();

    if (!serverAddress || !username || !password || !webhookUrl) {
      return NextResponse.json({ ok: false, error: "Server address, username, password, and webhook URL are required." }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(serverAddress);
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const payload: Record<string, string> = { url: webhookUrl, event: "sms:received" };
    if (deviceId) payload.device_id = deviceId;

    const res = await fetch(`${baseUrl}/3rdparty/v1/webhooks`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: `Gateway rejected registration (${res.status}): ${text}` }, { status: 200 });
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, webhookId: data.id, message: "Webhook registered successfully." });
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
