import type { Instrumentation } from "next";

/**
 * Faults on the server are reported (if reporting is on at all) from here: what kind of fault, where
 * in the application, and a scrubbed message. NOT the address that was asked for, its query, its
 * headers or anything that was sent with it: `request` is deliberately not read.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getMonitor } = await import("@/lib/monitoring");
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  await getMonitor().error("request_error", error, {
    route: context.routePath,
    routeType: context.routeType,
    ...(digest ? { digest } : {}),
  });
};
