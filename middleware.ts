import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: ["/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)"],
};

export default async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get("host") || "";
  
  const currentHost = "zulora.in"; 

  // LOGIC: Check if this is a user's subdomain
  // I added a check to IGNORE 'netlify.app' so your site loads!
  const isSubdomain = 
    hostname.includes(".") && 
    !hostname.endsWith(currentHost) && 
    !hostname.includes("www") && 
    !hostname.includes("vercel.app") &&
    !hostname.includes("netlify.app");  // <--- ADDED THIS FOR YOU

  if (isSubdomain) {
    const subdomain = hostname.split(".")[0];
    return NextResponse.rewrite(new URL(`/site/${subdomain}`, req.url));
  }

  return NextResponse.next();
}
