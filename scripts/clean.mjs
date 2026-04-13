import { rmSync } from "node:fs";
import { resolve } from "node:path";

const targets = [
  "apps/web/.next",
  "apps/web/.next-dev.out.log",
  "apps/web/.next-dev.err.log",
  "apps/web/tsconfig.tsbuildinfo"
];

for (const target of targets) {
  rmSync(resolve(process.cwd(), target), { recursive: true, force: true });
}

console.log("Cleaned local build artifacts.");
