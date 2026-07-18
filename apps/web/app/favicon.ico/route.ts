export const dynamic = "force-static";

export function GET(request: Request) {
  return Response.redirect(new URL("/icon.svg?v=brand-24", request.url), 307);
}
