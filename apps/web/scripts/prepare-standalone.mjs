import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptsDirectory, "..");
const standaloneAppDirectory = path.join(
  appDirectory,
  ".next",
  "standalone",
  "apps",
  "web",
);

await access(path.join(standaloneAppDirectory, "server.js"));
await mkdir(standaloneAppDirectory, { recursive: true });
await Promise.all([
  cp(
    path.join(appDirectory, ".next", "static"),
    path.join(standaloneAppDirectory, ".next", "static"),
    { recursive: true, force: true },
  ),
  cp(
    path.join(appDirectory, "public"),
    path.join(standaloneAppDirectory, "public"),
    { recursive: true, force: true },
  ),
]);
