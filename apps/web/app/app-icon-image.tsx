import { ImageResponse } from "next/og";

/**
 * Render a real PNG from the source vector instead of asking Android launchers
 * to rasterize an SVG themselves. Some launchers downsample SVG manifest icons
 * through a low-resolution intermediate bitmap, which makes installed PWA icons
 * look soft even though the source artwork is vector.
 */
export function renderAppIcon(size: number) {
  return new ImageResponse(
    (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 1254 1254"
        shapeRendering="geometricPrecision"
      >
        <defs>
          <radialGradient id="backgroundGradient" cx="47%" cy="40%" r="82%" fx="44%" fy="36%">
            <stop offset="0" stopColor="#f4efea" />
            <stop offset="0.34" stopColor="#eee7e1" />
            <stop offset="0.64" stopColor="#e5dcd4" />
            <stop offset="0.84" stopColor="#d9ccc2" />
            <stop offset="1" stopColor="#cdbdb2" />
          </radialGradient>

          <linearGradient id="backgroundLight" x1="0.08" y1="0.04" x2="0.92" y2="0.96">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="0.46" stopColor="#ffffff" stopOpacity="0.02" />
            <stop offset="1" stopColor="#8a705e" stopOpacity="0.08" />
          </linearGradient>

          <linearGradient id="outerBrown" gradientUnits="userSpaceOnUse" x1="455" y1="180" x2="825" y2="1110">
            <stop offset="0" stopColor="#a58d77" />
            <stop offset="0.20" stopColor="#8b715c" />
            <stop offset="0.42" stopColor="#725844" />
            <stop offset="0.65" stopColor="#563e2d" />
            <stop offset="0.84" stopColor="#412d20" />
            <stop offset="1" stopColor="#2e1f16" />
          </linearGradient>

          <linearGradient id="innerBrown" gradientUnits="userSpaceOnUse" x1="505" y1="405" x2="735" y2="900">
            <stop offset="0" stopColor="#8d725b" />
            <stop offset="0.22" stopColor="#795e48" />
            <stop offset="0.48" stopColor="#624936" />
            <stop offset="0.72" stopColor="#4d3627" />
            <stop offset="1" stopColor="#352318" />
          </linearGradient>

          <linearGradient id="letterGradient" gradientUnits="userSpaceOnUse" x1="230" y1="265" x2="680" y2="710">
            <stop offset="0" stopColor="#006ab9" />
            <stop offset="0.18" stopColor="#0863a7" />
            <stop offset="0.36" stopColor="#285f85" />
            <stop offset="0.54" stopColor="#59656a" />
            <stop offset="0.70" stopColor="#756351" />
            <stop offset="0.86" stopColor="#654a37" />
            <stop offset="1" stopColor="#493222" />
          </linearGradient>
        </defs>

        <rect width="1254" height="1254" fill="url(#backgroundGradient)" />
        <rect width="1254" height="1254" fill="url(#backgroundLight)" />

        <path
          d="M 516.3 257.4 A 387 410 0 1 1 241.9 609.3"
          fill="none"
          stroke="url(#outerBrown)"
          strokeWidth="78"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          d="M 537.1 475.5 A 192 204 0 1 1 439.8 604.7"
          fill="none"
          stroke="url(#innerBrown)"
          strokeWidth="74"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <path
          fill="url(#letterGradient)"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M 266 272 H 407 C 456 272 495 314 495 365 C 495 402 477 436 447 458 L 602 612 L 627 654 L 579 639 L 334 464 H 318 C 316 464 315 465 315 467 V 518 C 315 534 302 547 286 547 H 269 C 252 547 239 533 239 516 V 301 C 239 285 251 272 266 272 Z M 315 345 C 315 343 317 341 320 341 H 397 C 414 341 427 355 427 373 C 427 391 414 405 397 405 H 318 C 316 405 315 403 315 401 Z"
        />

        <circle cx="627" cy="654" r="50" fill="url(#letterGradient)" />
      </svg>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  );
}
