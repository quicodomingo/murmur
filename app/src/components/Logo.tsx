import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The "m" of the Eco mark (docs/design/icons/logo), on a 200 grid: a lowercase m and its echo,
 * shifted up and to the right. The voice and its transcript; also the "mur-mur" of the name.
 */
const M = "M60 140 V100 a18 18 0 0 1 36 0 V140 M96 100 a18 18 0 0 1 36 0 V140";

/**
 * The Murmur icon: the Eco mark on its square. Colours come from the theme (logoBackground,
 * logoBar1 for the "m", logoBar2 for the echo); a stroke in the background colour under the
 * front "m" leaves a gap between the two.
 */
export function LogoIcon({ size = 18, className, shadow }: { size?: number; className?: string; shadow?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden
      className={cn("shrink-0", className)}
      style={shadow ? { filter: "drop-shadow(0 10px 20px rgb(0 0 0 / 0.25))" } : undefined}
    >
      <rect width="200" height="200" rx="46" fill="var(--mm-logo-background)" />
      <g transform="translate(-4 -3)" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={M} transform="translate(15 -15)" stroke="var(--mm-logo-bar-2)" strokeWidth="17" />
        <path d={M} stroke="var(--mm-logo-background)" strokeWidth="27" />
        <path d={M} stroke="var(--mm-logo-bar-1)" strokeWidth="17" />
      </g>
    </svg>
  );
}

/** The Eco mark alone, in the current text colour; the gap is cut out, not painted. */
export function LogoMark({ size = 18, className }: { size?: number; className?: string }) {
  const cut = useId();
  return (
    <svg width={size} height={size} viewBox="34 38 128 128" aria-hidden className={cn("shrink-0", className)}>
      <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff" />
        <path d={M} transform="translate(-4 -3)" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="#000" strokeWidth="32" />
      </mask>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" strokeWidth="18">
        {/* The mask on a group: on the path it would move with the path's own offset. */}
        <g mask={`url(#${cut})`}>
          <path d={M} transform="translate(8 -15)" />
        </g>
        <path d={M} transform="translate(-4 -3)" />
      </g>
    </svg>
  );
}

/** "murmur" in Space Grotesk, whole and without separators, for the About window. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("text-[40px] font-bold leading-none tracking-[-0.045em]", className)} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      murmur
    </div>
  );
}
