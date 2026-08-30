import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import {
  ExternalRequestError,
  fetchExternalHttps,
  readExternalJson,
  validateExternalHttpsUrl,
} from "@/lib/api/externalRequest";

export const runtime = "nodejs";

// Verifies that the given SMS Gate (or compatible) credentials actually
// authenticate, without registering anything. Credentials are supplied
// per-request from the Setup UI — nothing is read from env vars, so any
// school can plug in their own gateway account.
//
// Guarded by requireStaffSession so this cannot be used as an anonymous
// credential-probing proxy against arbitrary SMS Gate servers.
export async function POST(request: Request) {
  const guard = await requireStaffSession({ permission: "setup" });
  if (guard) return guard;

  try {
    const { serverAddress, username, password } = await request.json();

    if (!serverAddress || !username || !password) {
      return NextResponse.json({ ok: false, error: "Server address, username, and password are all required." }, { status: 400 });
    }

    const baseUrl = await validateExternalHttpsUrl(serverAddress);
    const endpoint = new URL(baseUrl);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/3rdparty/v1/webhooks`;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetchExternalHttps(endpoint.href, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: "Authentication failed — check username and password." }, { status: 200 });
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Gateway responded with status ${res.status}.` }, { status: 200 });
    }

    const webhooks = await readExternalJson<unknown>(res);
    return NextResponse.json({ ok: true, message: "Connection successful.", existingWebhooks: Array.isArray(webhooks) ? webhooks.length : 0 });
  } catch (err: unknown) {
    const invalidRequest = err instanceof ExternalRequestError;
    return NextResponse.json(
      { ok: false, error: invalidRequest ? err.message : "Could not securely reach the gateway server." },
      { status: invalidRequest ? 400 : 502 },
    );
  }
}
