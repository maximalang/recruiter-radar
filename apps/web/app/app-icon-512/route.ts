import { serveGeneratedAppIcon } from "../app-icon-file";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return serveGeneratedAppIcon("app-icon-512.png");
}
