import { useTranslation } from "react-i18next";

/** Width limits for whichever panel sits on the right (notes or transcript). */
export const SIDE_WIDTH = { default: 320, min: 260, maxRatio: 0.6 };

/** Right-hand panel with a draggable left edge. */
export function SidePanel({ width, onResize, children }: { width: number; onResize: (w: number) => void; children: React.ReactNode }) {
  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l border-border bg-background" style={{ width }}>
      <ResizeHandle width={width} onResize={onResize} />
      {children}
    </aside>
  );
}

/** Drag the panel's left edge to resize it; double-click resets; arrow keys nudge. */
export function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const { t } = useTranslation("sidePanel");
  const clamp = (w: number) =>
    Math.round(Math.min(Math.max(w, SIDE_WIDTH.min), window.innerWidth * SIDE_WIDTH.maxRatio));
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => onResize(clamp(startWidth + startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resize")}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(SIDE_WIDTH.default)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(clamp(width + 20));
        if (e.key === "ArrowRight") onResize(clamp(width - 20));
      }}
      className="group absolute inset-y-0 -left-[3px] z-10 w-[6px] cursor-col-resize outline-none"
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}

