export const dynamic = "force-static";
export const revalidate = false;

export function GET(request: Request) {
  return Response.redirect(new URL("/icon.png?v=brand-24", request.url), 307);
}
