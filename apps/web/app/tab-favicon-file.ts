import { readFile } from "node:fs/promises";
import path from "node:path";

export async function serveGeneratedTabFavicon(filename: string) {
  const candidates = [
    path.join(process.cwd(), "public", "tab-icons", filename),
    path.join(process.cwd(), "apps", "web", "public", "tab-icons", filename),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const icon = await readFile(candidate);
      return new Response(icon, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(icon.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
