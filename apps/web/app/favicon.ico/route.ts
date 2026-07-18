import icon from "../../public/favicon-brand19.png";

export const dynamic = "force-static";

export function GET(request: Request) {
  return Response.redirect(new URL(icon.src, request.url), 307);
}
