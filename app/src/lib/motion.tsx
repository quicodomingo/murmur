import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { cn } from "@/lib/utils";

/** Where a selection's background sits inside its container (px), and whether to animate to it. */
export type Marker = { x: number; y: number; w: number; h: number; animate: boolean };

/**
 * The selection's background that slides from the old choice to the new one (settings sections,
 * segmented controls, the meetings list). The chosen child carries `data-marker="<key>"`; the
 * container is `relative` and the child's offset parent. It only animates once it has been
 * placed: opening a window or a list shouldn't slide it in from the corner. `deps`: anything else
 * that moves the children (the list changing, the labels' language); a change in the chosen
 * child's own size is followed on its own.
 */
export function useMarker(container: RefObject<HTMLElement | null>, key: string | null | undefined, deps: unknown[] = []): Marker | null {
  const [marker, setMarker] = useState<Marker | null>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = key == null ? null : container.current?.querySelector<HTMLElement>(`[data-marker="${CSS.escape(key)}"]`);
    if (!el) {
      placed.current = false;
      setMarker(null);
      return;
    }
    const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, animate: placed.current };
    placed.current = true;
    setMarker(next);
    // The chosen child can change size after it's placed: the font loading, a label that becomes
    // bolder or wider (English "Summary" overflowed its background). Follow it, without sliding.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setMarker((m) => {
        const now = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
        if (m && m.x === now.x && m.y === now.y && m.w === now.w && m.h === now.h) return m;
        return { ...now, animate: false };
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [key, ...deps]);
  return marker;
}

/** The sliding background itself: 200 ms ease-out; with "Reduce motion" it jumps. */
export function MarkerBackground({ marker, className, children }: { marker: Marker | null; className?: string; children?: React.ReactNode }) {
  if (!marker) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-0 top-0 motion-reduce:transition-none",
        marker.animate && "transition-[transform,width,height] duration-200 ease-out",
        className,
      )}
      style={{ width: marker.w, height: marker.h, transform: `translate(${marker.x}px, ${marker.y}px)` }}
    >
      {children}
    </span>
  );
}
