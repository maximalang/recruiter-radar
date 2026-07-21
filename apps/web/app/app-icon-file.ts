import { readFile } from "node:fs/promises";
import path from "node:path";

async function serveGeneratedIcon(directory: string, filename: string) {
  const candidates = [
    path.join(process.cwd(), "public", directory, filename),
    path.join(process.cwd(), "apps", "web", "public", directory, filename),
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

export function serveGeneratedAppIcon(filename: string) {
  return serveGeneratedIcon("app-icons", filename);
}

export function serveGeneratedTabIcon(filename: string) {
  return serveGeneratedIcon("tab-icons", filename);
}
