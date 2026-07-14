/**
 * Inline-SVG icon system — the single visual vocabulary for Recruiter Radar.
 *
 * Why this exists: the product previously used emoji (🔥🌍✋🤝🏭 …) as interface
 * iconography. Emoji render inconsistently across platforms, cannot be styled
 * with the design tokens, and read as a "bot/Telegram" vocabulary rather than a
 * calm premium B2B tool. This module replaces them with one stroke-based,
 * `currentColor` SVG set so every chip, badge, meta row, and button speaks the
 * same visual language and inherits its tone from the surrounding CSS.
 *
 * Rules:
 *   - 24×24 viewBox, stroke-width 1.75, round joins/caps — one weight only.
 *   - `aria-hidden` by default; callers add labels via the surrounding control.
 *   - No fills except where a glyph is naturally solid (e.g. dots). Stroke only.
 *   - `currentColor` so tone comes from CSS `color`, never hardcoded.
 *
 * Consumers render `<Icon name="…" />` or a named export. Keep the set small:
 * add a glyph only when a real UI surface needs it.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  /** Optional size in px; defaults to 1em so the icon tracks its font-size. */
  size?: number | string;
};

function Svg({ size = '1em', children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Fit dimensions (Почему подходит) ── */

export function IndustryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 21h18M5 21V8l6-4v17M13 21V11l6 3v7M9 12v.01M9 16v.01" />
    </Svg>
  );
}

export function RoleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.6a1.6 1.6 0 0 0-.9 1.5v3.2a1 1 0 0 1-1 1H7.6a1.6 1.6 0 1 0 0 3.2h.8a1 1 0 0 1 1 1v3.2a1.6 1.6 0 0 0 2.7 1.1l1.5-1.2a1 1 0 0 1 1.3.1l.9.9a1.6 1.6 0 1 0 2.3-2.3l-.9-.9a1 1 0 0 1-.1-1.3l1.2-1.5a1.6 1.6 0 0 0-1.1-2.7h-3.2a1 1 0 0 1-1-1V5.1a1.6 1.6 0 0 0-1.5-.9z" />
    </Svg>
  );
}

export function TargetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </Svg>
  );
}

/**
 * RadarLogo — the product's primary brand mark.
 *
 * An instrument-grade radar scope: three concentric range rings, four short
 * cardinal crosshair ticks (N/E/S/W), and a directional sweep — a thin bright
 * BEAM (the leading edge) with a NARROW ~45° fading TRAIL behind it built from
 * three stacked sectors of decreasing opacity (brightest at the beam,
 * dissolving counterclockwise into the afterglow) — the way a real radar
 * scope's sweep actually reads, not a wide solid pie wedge. The beam points
 * down-right, the radar "looking down" at the market (scanning for hiring
 * signals below the surface). Three "blip" contacts sit on the dial at
 * different bearings/ranges and FLASH ON the moment the rotating sweep passes
 * over them, then fade — the literal behaviour of a real radar (contacts light
 * up under the scan, not statically). Three contacts (not two) read as a
 * populated airspace — "the market has activity", not "two stray dots".
 *
 * Built to read at 16px (favicon / sticky header) and stay crisp at 48px. The
 * rings step brightness inward; the beam trail is three stacked fading sectors
 * (a true angular afterglow), so motion reads as a lit scan, not a flat cartoon
 * wedge. Still `currentColor` so tone comes from CSS — the brand blue on light
 * surfaces.
 *
 * Used as the site logo (landing header, animated) and the shared internal
 * TopNav (static), and the `app/icon.svg` favicon mirrors it, so every surface
 * carries one brand identity.
 *
 * `animate` does two things on a 9s loop (matched to the hero RadarCanvas
 * pace), both driven by stable global classes defined in the landing CSS module
 * via `:global` (so they aren't hashed) with `transform-origin` at the glyph
 * center (12px 12px in the 24-unit viewBox):
 *   1. rotates the sweep group (`rr-sweep-spin`) — a full clockwise turn;
 *   2. fires each blip's flash (`rr-blip-a` / `rr-blip-b` / `rr-blip-c`) once
 *      per loop, timed so the flash peaks exactly when the rotating beam is over
 *      that blip's bearing. The beam starts at ~153° (down-right) and sweeps
 *      clockwise 360°/9s, so it reaches:
 *        blip A — bearing 200°, r5.6 → t≈1.18s → spike at ~13% of loop;
 *        blip C — bearing 315°, r7.0 → t≈4.05s → spike at ~45% of loop;
 *        blip B — bearing  60°, r7.4 → t≈6.68s → spike at ~74% of loop.
 *      The CSS keyframe opacity spikes are placed at those fractions to match.
 *      Honors prefers-reduced-motion (static mark).
 *
 * When `animate` is false/omitted the glyph renders as a calm static mark
 * (sweep pointing down-right, blips at a low idle opacity) — for the shared
 * TopNav and the favicon.
 *
 * Signature: `(p: IconProps & { animate?: boolean })` — additive optional
 * prop; the static TopNav call is unchanged.
 */
export function RadarLogo(p: IconProps & { animate?: boolean }) {
  const { animate, size, ...svgProps } = p;
  // Blip geometry — bearing (clockwise from 12 o'clock) + range radius.
  // Computed once so the static + animated branches share identical positions.
  const blipA = {
    cx: (12 + Math.sin((200 * Math.PI) / 180) * 5.6).toFixed(2),
    cy: (12 - Math.cos((200 * Math.PI) / 180) * 5.6).toFixed(2),
    animClass: 'rr-blip-a',
  };
  const blipB = {
    cx: (12 + Math.sin((60 * Math.PI) / 180) * 7.4).toFixed(2),
    cy: (12 - Math.cos((60 * Math.PI) / 180) * 7.4).toFixed(2),
    animClass: 'rr-blip-b',
  };
  const blipC = {
    cx: (12 + Math.sin((315 * Math.PI) / 180) * 7.0).toFixed(2),
    cy: (12 - Math.cos((315 * Math.PI) / 180) * 7.0).toFixed(2),
    animClass: 'rr-blip-c',
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...svgProps}
    >
      {/* Range rings — three concentric circles, the radar's defining shape.
          Brightness steps inward so the focal area reads without a hard fill. */}
      <circle cx="12" cy="12" r="9.4" opacity={0.26} />
      <circle cx="12" cy="12" r="6.1" opacity={0.46} />
      <circle cx="12" cy="12" r="3" opacity={0.78} />
      {/* Cardinal crosshair ticks — the four marks a real radar face carries at
          N/E/S/W. Short (only across the outermost ring) and quiet so they give
          the mark instrument precision without competing with the rings. */}
      <line x1="12" y1="0.9" x2="12" y2="2.4" opacity={0.42} />
      <line x1="12" y1="21.6" x2="12" y2="23.1" opacity={0.42} />
      <line x1="0.9" y1="12" x2="2.4" y2="12" opacity={0.42} />
      <line x1="21.6" y1="12" x2="23.1" y2="12" opacity={0.42} />
      {/* Detected contacts — three blips on the dial at different bearings and
          ranges. In the static mark they sit at a low idle opacity (faint
          contacts the radar has seen before); when `animate` is set each fires a
          bright flash timed to the rotating sweep passing its bearing, then
          fades — the literal "contact lights up under the scan" of a real
          radar. Drawn BEFORE the sweep so the bright beam paints over them at
          its leading edge; the flash reads behind the sweep. */}
      <circle
        cx={blipA.cx}
        cy={blipA.cy}
        r={animate ? 1.6 : 1.2}
        fill="currentColor"
        stroke="none"
        className={animate ? blipA.animClass : undefined}
        opacity={animate ? undefined : 0.5}
      />
      <circle
        cx={blipB.cx}
        cy={blipB.cy}
        r={animate ? 1.6 : 1.2}
        fill="currentColor"
        stroke="none"
        className={animate ? blipB.animClass : undefined}
        opacity={animate ? undefined : 0.5}
      />
      <circle
        cx={blipC.cx}
        cy={blipC.cy}
        r={animate ? 1.5 : 1.1}
        fill="currentColor"
        stroke="none"
        className={animate ? blipC.animClass : undefined}
        opacity={animate ? undefined : 0.45}
      />
      {/* The sweep — a real radar scan: a thin bright BEAM (the leading edge)
          with a NARROW fading TRAIL behind it (the region just swept), not a
          wide solid pie wedge. The beam points to bearing ~153° (down-right);
          the sweep rotates clockwise 360°/9s (group `rr-sweep-spin`, bearing
          increasing), so the AFTERGLOW is the ~45° fan BEHIND the beam —
          bearings 153→108 (decreasing, counterclockwise from the beam, the
          region just swept). The trail is three stacked 15° sectors of
          DECREASING opacity (0.30 → 0.16 → 0.07), brightest right at the beam
          edge (153°) and dissolving toward 108° — exactly how a real radar
          scope's afterglow reads. The arc sweep flag is 0 (counterclockwise =
          decreasing bearing = behind a clockwise beam); a flag of 1 would draw
          the fan AHEAD of the beam, which is wrong. The blips' flash timings
          (A 13% / C 45% / B 74% of the loop) are computed from the same 153°
          start bearing and stay correct with this geometry. */}
      <g className={animate ? 'rr-sweep-spin' : undefined}>
        {/* Trail — three stacked 15° sectors, brightest at the beam edge (153°)
            and dissolving counterclockwise toward 108°. Each arc sweep flag is
            0 so the sector opens BEHIND the beam (decreasing bearing). */}
        <path d="M12 12 L16.27 20.38 A9.4 9.4 0 0 0 18.29 18.99 Z" fill="currentColor" stroke="none" opacity={0.3} />
        <path d="M12 12 L18.29 18.99 A9.4 9.4 0 0 0 19.88 17.12 Z" fill="currentColor" stroke="none" opacity={0.16} />
        <path d="M12 12 L19.88 17.12 A9.4 9.4 0 0 0 20.94 14.90 Z" fill="currentColor" stroke="none" opacity={0.07} />
        {/* The leading beam edge — the bright radial line currently scanning,
            pointing down-right. The eye-leading element that makes the sweep
            read as a rotating scan, not a static shape. */}
        <line
          x1="12"
          y1="12"
          x2="16.27"
          y2="20.38"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.95}
        />
      </g>
      {/* Center origin — a small filled node at the focal point. Tight radius
          (1) keeps it crisp; no pulse animation (the sweep + blips carry all
          the motion). */}
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </Svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" />
      <path d="M9.2 12l2 2 3.6-3.8" />
    </Svg>
  );
}

export function MailIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M4 7l8 6 8-6" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12.5l4.5 4.5 10.5-11" />
    </Svg>
  );
}

/* ── Feedback / triage ── */

export function HandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 11V6.5a1.3 1.3 0 0 1 2.6-.1V11m0-.2V5.5a1.3 1.3 0 0 1 2.6 0V11m0-.5V7a1.3 1.3 0 0 1 2.6 0v6.5a5.5 5.5 0 0 1-5.5 5.5h-1.2a4.5 4.5 0 0 1-3.4-1.6L5 14.2a1.4 1.4 0 0 1 2.1-1.8L8 13.5" />
    </Svg>
  );
}

export function ChatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 16h-7l-4 3.5V16H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 5z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </Svg>
  );
}

export function HandshakeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 8l3.5-2 3 1.5L13 10l2-1 3 2 3-1.5M5.5 9l-1.5 4 4 3 2-1.5 2 1.5 2-1.5 2 1.5 3-2.5-1.5-3.5" />
      <path d="M9.5 14.5l1.5 1.5M14 13l1.5 1.5" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function WaveIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0M3 16c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    </Svg>
  );
}

export function XIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

/* ── Status / review ── */

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </Svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5l9.5 16.5a1 1 0 0 1-.9 1.5H3.4a1 1 0 0 1-.9-1.5L12 3.5z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </Svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </Svg>
  );
}

/* ── Signal / urgency / score band ── */

export function FlameIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5c2.5 3 4 5.5 4 8a4 4 0 0 1-8 0c0-1.2.5-2.3 1.2-3.2.2 1 .8 1.7 1.6 1.7 1 0 1.4-.8 1.4-1.8 0-1.3-.6-2.7-1.6-4z" />
    </Svg>
  );
}

export function TrendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 17l5.5-5 3.5 3 7-7.5M21 10V5h-5" />
    </Svg>
  );
}

export function SparkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 4v.01M5 18v.01" />
    </Svg>
  );
}

export function DropIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0c0-3 2-5.5 5-9.5z" />
    </Svg>
  );
}

/* ── Meta rows (lead card / evidence) ── */

export function BriefcaseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2.5" />
      <path d="M9 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
    </Svg>
  );
}

export function FileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M8 13h8M8 17h6" />
    </Svg>
  );
}

export function LayersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4l8 4-8 4-8-4 8-4z" />
      <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 14.5l5-5" />
      <path d="M8 12.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 11.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
    </Svg>
  );
}

export function GlobeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14.5 0 17M12 3.5c-2.5 2.5-2.5 14.5 0 17" />
    </Svg>
  );
}

export function HelpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.1.8-1.1 1.6v.4M12 16.5v.01" />
    </Svg>
  );
}

/* ── Navigation / affordance (Phase 0 UX-hardening enablers) ── */

/**
 * Back / arrow-left — the single back-affordance glyph for nav, back-links, and
 * not-found states. Replaces the literal `←` character that lived in TopNav,
 * lead-detail back-link, and not-found back-labels so every back affordance
 * speaks the SVG vocabulary.
 */
export function BackIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

/**
 * Empty circle — the unfilled counterpart to CheckIcon for the profile-
 * completion checklist. Pairs with CheckIcon so a filled filter row shows the
 * brand-tone CheckIcon and an unfilled row shows the muted empty circle,
 * replacing the literal `○` character.
 */
export function CircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8" />
    </Svg>
  );
}

/**
 * Bell — the browser-push channel glyph for the delivery-preferences form.
 * Semantic only (marks the push channel section header); never decorative.
 */
export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5 2 6H4c.5-1 2-2 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}
