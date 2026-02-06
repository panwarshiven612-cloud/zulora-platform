import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)"],
};

export default async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  
  // Define the main domain
  const currentHost = "zulora.in"; // Hardcoded for safety

  // LOGIC: Check if this is a user's subdomain
  const isSubdomain = 
    hostname.includes(".") && 
    !hostname.endsWith(currentHost) && 
    !hostname.includes("www") && 
    !hostname.includes("vercel.app"); // <--- THIS LINE FIXES YOUR ERROR

  if (isSubdomain) {
    const subdomain = hostname.split(".")[0];
    return NextResponse.rewrite(new URL(`/site/${subdomain}`, req.url));
  }

  return NextResponse.next();
}
