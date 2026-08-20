import { NextResponse } from "next/server";

// Verifies that the given SMS Gate (or compatible) credentials actually
// authenticate, without registering anything. Credentials are supplied
// per-request from the Setup UI — nothing is read from env vars, so any
// school can plug in their own gateway account.
export async function POST(request: Request) {
  try {
    const { serverAddress, username, password } = await request.json();

    if (!serverAddress || !username || !password) {
      return NextResponse.json({ ok: false, error: "Server address, username, and password are all required." }, { status: 400 });
    }

    const baseUrl = normalizeBaseUrl(serverAddress);
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetch(`${baseUrl}/3rdparty/v1/webhooks`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: "Authentication failed — check username and password." }, { status: 200 });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Gateway responded with status ${res.status}.` }, { status: 200 });
    }

    const webhooks = await res.json();
    return NextResponse.json({ ok: true, message: "Connection successful.", existingWebhooks: Array.isArray(webhooks) ? webhooks.length : 0 });
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
