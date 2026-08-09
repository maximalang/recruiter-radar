export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/tab-icons/tab-icon-32.png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
