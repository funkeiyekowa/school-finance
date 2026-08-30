/**
 * Client-error sink.
 *
 * The route-segment error boundary (src/app/error.tsx) and the root
 * boundary (src/app/global-error.tsx) POST caught errors here so they
 * land in the same error_log table as server-side failures. Without
 * this endpoint, uncaught client renders would only surface in the
 * browser console — invisible to operators without user cooperation.
 *
 * Auth-optional: even anonymous callers (e.g. a broken /login page)
 * can post here, because losing the ability to see login errors would
 * be a real regression. To prevent abuse, we rate-limit by IP and
 * cap the payload sizes strictly.
 */

import { NextResponse } from "next/server";
import { logError, requestContext } from "@/lib/errors/logError";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";

const MAX_MSG_LEN = 500;
const MAX_STACK_LEN = 4000;
const CLIENT_ERR_RATE_MAX = 60; // per minute per IP
const CLIENT_ERR_RATE_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const ip = callerKey(request);
  const rl = rateLimit({
    name: "client-error",
    key: ip,
    max: CLIENT_ERR_RATE_MAX,
    windowMs: CLIENT_ERR_RATE_WINDOW_MS,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, reason: "rate-limited" }, { status: 429 });
  }

  let body: {
    message?: unknown;
    stack?: unknown;
    digest?: unknown;
    source?: unknown;
    path?: unknown;
    componentStack?: unknown;
    userAgent?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.slice(0, MAX_MSG_LEN) : "Client error";
  const stack = typeof body.stack === "string" ? body.stack.slice(0, MAX_STACK_LEN) : null;
  const digest = typeof body.digest === "string" ? body.digest : null;
  const source = typeof body.source === "string" && body.source ? body.source : "ui:unknown";
  const clientPath = typeof body.path === "string" ? body.path : null;
  const componentStack =
    typeof body.componentStack === "string" ? body.componentStack.slice(0, MAX_STACK_LEN) : null;

  await logError({
    source,
    severity: "error",
    message,
    stack,
    context: {
      digest,
      client_path: clientPath,
      component_stack: componentStack,
    },
    ...requestContext(request),
  });

  return NextResponse.json({ ok: true });
}
