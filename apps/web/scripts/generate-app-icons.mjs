import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptsDirectory, "..");
const require = createRequire(path.join(appDirectory, "package.json"));
const sharp = require("sharp");
const sourcePath = path.join(appDirectory, "public", "recruiter-radar-logo.svg");
const outputDirectory = path.join(appDirectory, "public", "app-icons");

const standardSizes = [48, 64, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024];
const maskableSizes = [192, 512, 1024];
const masterSize = 4096;

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const sourceSvg = await readFile(sourcePath);
const { data: masterPixels, info: masterInfo } = await sharp(sourceSvg, {
  density: 320,
  limitInputPixels: false,
})
  .resize(masterSize, masterSize, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (const size of standardSizes) {
  const outputPath = path.join(outputDirectory, `app-icon-${size}.png`);
  const info = await sharp(masterPixels, {
    raw: {
      width: masterInfo.width,
      height: masterInfo.height,
      channels: masterInfo.channels,
    },
  })
    .resize(size, size, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: 0.35 })
    .png({
      compressionLevel: 9,
      progressive: false,
      palette: false,
    })
    .toFile(outputPath);

  if (info.width !== size || info.height !== size || info.format !== "png") {
    throw new Error(`Invalid generated icon: ${outputPath}`);
  }
}

// The artwork already has a full-bleed background and the mark sits inside the
// adaptive-icon safe zone. Separate files prevent launchers from reusing a
// previously cached non-maskable resource for the maskable purpose.
for (const size of maskableSizes) {
  await copyFile(
    path.join(outputDirectory, `app-icon-${size}.png`),
    path.join(outputDirectory, `maskable-${size}.png`),
  );
}

console.log(
  `Generated ${standardSizes.length + maskableSizes.length} native PNG app icons from ${path.basename(sourcePath)}.`,
);
