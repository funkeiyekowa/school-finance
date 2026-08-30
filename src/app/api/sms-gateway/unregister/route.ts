import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import {
  ExternalRequestError,
  fetchExternalHttps,
  validateExternalHttpsUrl,
} from "@/lib/api/externalRequest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await requireStaffSession({ permission: "setup" });
  if (guard) return guard;

  try {
    const { serverAddress, username, password, webhookId } = await request.json();

    if (!serverAddress || !username || !password || !webhookId) {
      return NextResponse.json({ ok: false, error: "Server address, username, password, and webhook ID are required." }, { status: 400 });
    }

    const baseUrl = await validateExternalHttpsUrl(serverAddress);
    const endpoint = new URL(baseUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/3rdparty/v1/webhooks/${encodeURIComponent(webhookId)}`;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetchExternalHttps(endpoint.href, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok && res.status !== 404) {
      return NextResponse.json(
        { ok: false, error: `Gateway rejected removal with status ${res.status}.` },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, message: "Webhook removed." });
  } catch (err: unknown) {
    const invalidRequest = err instanceof ExternalRequestError;
    return NextResponse.json(
      { ok: false, error: invalidRequest ? err.message : "Could not securely reach the gateway server." },
      { status: invalidRequest ? 400 : 502 },
    );
  }
}
