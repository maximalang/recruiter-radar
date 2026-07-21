import { serveGeneratedTabFavicon } from "../tab-favicon-file";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return serveGeneratedTabFavicon("tab-icon-16.png");
}
