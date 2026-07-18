import { FAVICON_DATA_URL } from "../favicon-data";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  const encoded = FAVICON_DATA_URL.slice(FAVICON_DATA_URL.indexOf(",") + 1);
  const icon = Uint8Array.from(
    atob(encoded),
    (character) => character.charCodeAt(0),
  );

  return new Response(icon, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(icon.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
