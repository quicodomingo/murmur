import { cn } from "@/lib/utils";

/**
 * The Murmur icon: two rounded bars, "mur-mur", two walls (docs/design/icons/logo). Colours come
 * from the theme (logoBackground, logoBar1, logoBar2).
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
      <rect x="62" y="52" width="26" height="96" rx="13" fill="var(--mm-logo-bar-1)" />
      <rect x="112" y="52" width="26" height="96" rx="13" fill="var(--mm-logo-bar-2)" />
    </svg>
  );
}

/** Monochrome mark (one bar full, one outlined), drawn in the current text colour. */
export function LogoMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className={cn("shrink-0", className)}>
      <rect x="3" y="3" width="3.5" height="12" rx="1.75" fill="currentColor" />
      <rect x="9.25" y="3.75" width="2" height="10.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** "mur|mur" in Space Grotesk, for the About window. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center text-[40px] font-bold leading-none tracking-[-0.04em]", className)}
      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      aria-label="murmur"
    >
      <span>mur</span>
      <span className="mx-[7px] mt-1 inline-block h-[30px] w-1 rounded-[2px] bg-mm-sidebar-selection-bar" aria-hidden />
      <span className="text-mm-text-tertiary">mur</span>
    </div>
  );
}
