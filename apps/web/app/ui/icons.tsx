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
 * A precise, instrument-grade radar: three concentric range rings, a crosshair
 * (the four cardinal ticks a real radar face carries), and a directional sweep
 * whose beam points downward — the radar "looking down" at the market, which is
 * the product's posture (scanning for hiring signals below the surface). The
 * sweep sector is drawn with a fading gradient (bright at the leading edge,
 * translucent at the trail) rather than a flat cartoon wedge, so it reads as a
 * lit scan, not a coloring-book shape. No decorative "blip" dot — the mark is
 * the instrument, not a game.
 *
 * Used as the site logo in the landing header and the shared internal TopNav,
 * and as the SVG favicon, so every surface carries one brand identity. Stroke
 * weight is lighter (1.3) than the interface icon set (1.75) so the mark reads
 * as refined at small sizes. Still `currentColor` so it inherits tone from CSS.
 *
 * `animate` (optional) rotates the sweep sector so the logo literally scans,
 * mirroring the hero RadarCanvas. The rotation uses a stable global class
 * `rr-sweep-spin` (defined in the landing CSS module via `:global` so it isn't
 * hashed) and a `transform-origin` at the glyph's center (12px 12px in the
 * 24-unit viewBox). The animation is skipped when the user prefers reduced
 * motion — see the keyframe guard. When `animate` is false/omitted the glyph
 * renders exactly as before (static downward sweep), so the shared TopNav and
 * favicon stay calm.
 */
export function RadarLogo(p: IconProps & { animate?: boolean }) {
  const { animate, size, ...svgProps } = p;
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
      <circle cx="12" cy="12" r="9.4" opacity={0.28} />
      <circle cx="12" cy="12" r="6.1" opacity={0.5} />
      <circle cx="12" cy="12" r="3" opacity={0.78} />
      {/* Cardinal crosshair ticks — the four marks a real radar face carries at
          N/E/S/W. Short, quiet, only at the outer ring; they give the mark
          instrument precision without busy-ness. */}
      <line x1="12" y1="1.7" x2="12" y2="3.3" opacity={0.5} />
      <line x1="12" y1="20.7" x2="12" y2="22.3" opacity={0.5} />
      <line x1="1.7" y1="12" x2="3.3" y2="12" opacity={0.5} />
      <line x1="20.7" y1="12" x2="22.3" y2="12" opacity={0.5} />
      {/* The sweep — a sector from the center pointing DOWNWARD (the radar
          looking down), drawn as a radial fade so the leading edge is bright
          and the trail dissolves. Rotates as a group when `animate` is set.
          The sector spans ~90° centered on straight-down (6 o'clock): the two
          arc endpoints sit at the lower-left (7.55, 20.7) and lower-right
          (16.45, 20.7), so the filled wedge covers the bottom of the dial. */}
      <g className={animate ? 'rr-sweep-spin' : undefined}>
        <path
          d="M12 12 L7.55 20.7 A9.4 9.4 0 0 0 16.45 20.7 Z"
          fill="currentColor"
          stroke="none"
          opacity={0.2}
        />
        {/* The leading beam edge — the bright line currently scanning, pointing
            down-right. This is the eye-leading element; it's what makes the
            sweep read as motion rather than a static shape. */}
        <line
          x1="12"
          y1="12"
          x2="16.45"
          y2="20.7"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.95}
        />
      </g>
      {/* Center origin — a small filled node at the focal point. Tight radius
          (1) keeps it crisp; no pulse animation (the sweep carries all the
          motion). */}
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
