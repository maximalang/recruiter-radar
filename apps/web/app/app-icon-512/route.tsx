import { renderAppIcon } from "../app-icon-image";

export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return renderAppIcon(512);
}
