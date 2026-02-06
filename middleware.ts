import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)"],
};

export default async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  const currentHost = process.env.NODE_ENV === "production" ? "zulora.in" : "localhost:3000";
  
  const isSubdomain = 
    hostname.includes(".") && 
    !hostname.endsWith(currentHost) && 
    !hostname.includes("www");

  if (isSubdomain) {
    const subdomain = hostname.split(".")[0];
    return NextResponse.rewrite(new URL(`/site/${subdomain}`, req.url));
  }

  return NextResponse.next();
}