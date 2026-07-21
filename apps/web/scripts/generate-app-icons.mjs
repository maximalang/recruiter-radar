import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(scriptsDirectory, "..");
const require = createRequire(path.join(appDirectory, "package.json"));
const sharp = require("sharp");

const appSourcePath = path.join(appDirectory, "public", "recruiter-radar-app-source.svg");
const tabSourcePath = path.join(appDirectory, "public", "recruiter-radar-logo.svg");
const appOutputDirectory = path.join(appDirectory, "public", "app-icons");
const tabOutputDirectory = path.join(appDirectory, "public", "tab-icons");

const standardSizes = [48, 64, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024];
const maskableSizes = [192, 512, 1024];
const tabFallbackSizes = [192, 512];
const masterSize = 4096;

async function renderMaster(sourcePath) {
  const sourceSvg = await readFile(sourcePath);
  return sharp(sourceSvg, { density: 320, limitInputPixels: false })
    .resize(masterSize, masterSize, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function writePng(master, outputPath, size) {
  const info = await sharp(master.data, {
    raw: {
      width: master.info.width,
      height: master.info.height,
      channels: master.info.channels,
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

await Promise.all([
  rm(appOutputDirectory, { recursive: true, force: true }),
  rm(tabOutputDirectory, { recursive: true, force: true }),
]);
await Promise.all([
  mkdir(appOutputDirectory, { recursive: true }),
  mkdir(tabOutputDirectory, { recursive: true }),
]);

const appMaster = await renderMaster(appSourcePath);
for (const size of standardSizes) {
  await writePng(appMaster, path.join(appOutputDirectory, `app-icon-${size}.png`), size);
}

for (const size of maskableSizes) {
  await copyFile(
    path.join(appOutputDirectory, `app-icon-${size}.png`),
    path.join(appOutputDirectory, `maskable-${size}.png`),
  );
}

// Browser engines may prefer a PNG rel=icon candidate over the SVG. Generate
// those fallback candidates from the rounded favicon artwork, not the unrounded
// installed-app source, so every possible tab icon has identical rounded edges.
const tabMaster = await renderMaster(tabSourcePath);
for (const size of tabFallbackSizes) {
  await writePng(tabMaster, path.join(tabOutputDirectory, `tab-icon-${size}.png`), size);
}

console.log(
  `Generated ${standardSizes.length + maskableSizes.length} PWA icons and ${tabFallbackSizes.length} rounded tab fallbacks.`,
);
