import { serveGeneratedTabIcon } from "../app-icon-file";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return serveGeneratedTabIcon("tab-icon-512.png");
}
