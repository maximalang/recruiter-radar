import favicon from "../../public/favicon-brand19.png";

export const dynamic = "force-static";
export const revalidate = false;

export function GET(request: Request) {
  const target = new URL(favicon.src, request.url);
  return Response.redirect(target, 307);
}
