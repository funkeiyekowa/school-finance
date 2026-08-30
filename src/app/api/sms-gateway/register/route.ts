import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import {
  ExternalRequestError,
  fetchExternalHttps,
  parseExternalHttpsUrl,
  readExternalJson,
  validateExternalHttpsUrl,
} from "@/lib/api/externalRequest";

export const runtime = "nodejs";

// Registers our webhook endpoint with the school's SMS Gate account using
// the credentials they entered in Setup > SMS Gateway (never hardcoded).
export async function POST(request: Request) {
  const guard = await requireStaffSession({ permission: "setup" });
  if (guard) return guard;

  try {
    const { serverAddress, username, password, webhookUrl, deviceId } = await request.json();

    if (!serverAddress || !username || !password || !webhookUrl) {
      return NextResponse.json({ ok: false, error: "Server address, username, password, and webhook URL are required." }, { status: 400 });
    }

    const baseUrl = await validateExternalHttpsUrl(serverAddress);
    const callbackUrl = parseExternalHttpsUrl(webhookUrl);
    const endpoint = new URL(baseUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/3rdparty/v1/webhooks`;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const payload: Record<string, string> = { url: callbackUrl.href, event: "sms:received" };
    if (deviceId) payload.device_id = deviceId;

    const res = await fetchExternalHttps(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Gateway rejected registration with status ${res.status}.` },
        { status: 200 },
      );
    }

    const data = await readExternalJson<{ id?: string }>(res);
    if (!data.id) {
      return NextResponse.json({ ok: false, error: "Gateway did not return a webhook ID." }, { status: 200 });
    }
    return NextResponse.json({ ok: true, webhookId: data.id, message: "Webhook registered successfully." });
  } catch (err: unknown) {
    const invalidRequest = err instanceof ExternalRequestError;
    return NextResponse.json(
      { ok: false, error: invalidRequest ? err.message : "Could not securely reach the gateway server." },
      { status: invalidRequest ? 400 : 502 },
    );
  }
}
