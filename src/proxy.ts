import { NextResponse, type NextRequest } from "next/server";

// One public address: visits to the old Render host (or www.) move to APP_URL's host, path and query kept.
// Only those hosts are redirected, and only when APP_URL points elsewhere, so local dev and the switch-over are safe.
// PayPal webhooks and the /v1 API are excluded (matcher below): their callers have the old URL registered.
export function proxy(req: NextRequest) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return NextResponse.next();
  const primary = new URL(appUrl);
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host || host === primary.host) return NextResponse.next();
  if (!host.endsWith(".onrender.com") && host !== `www.${primary.host}`) return NextResponse.next();
  return NextResponse.redirect(new URL(req.nextUrl.pathname + req.nextUrl.search, primary.origin), 308);
}

export const config = {
  matcher: ["/((?!api/paypal/webhook|v1/|_next/static|_next/image|favicon.ico).*)"],
};
