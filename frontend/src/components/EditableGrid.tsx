import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Grip, Maximize2, RotateCcw } from "lucide-react";

export type GridLayoutItem = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

export type EditableGridItem = GridLayoutItem & {
  title: string;
  content: ReactNode;
};

type ActiveEdit = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  start: GridLayoutItem;
};

type EditableGridProps = {
  storageKey: string;
  items: EditableGridItem[];
  columns?: number;
  rowHeight?: number;
  gap?: number;
  editable?: boolean;
  toolbar?: boolean;
  resetNonce?: number;
  helperText?: string;
  className?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLayout(items: EditableGridItem[], saved?: Record<string, GridLayoutItem>) {
  const next: Record<string, GridLayoutItem> = {};
  for (const item of items) {
    const savedItem = saved?.[item.id];
    next[item.id] = savedItem
      ? {
          id: item.id,
          x: savedItem.x,
          y: savedItem.y,
          w: savedItem.w,
          h: savedItem.h,
          minW: item.minW,
          minH: item.minH
        }
      : { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH };
  }
  return next;
}

function loadLayout(storageKey: string, items: EditableGridItem[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return normalizeLayout(items, parsed);
  } catch {
    return normalizeLayout(items);
  }
}

export function EditableGrid({
  storageKey,
  items,
  columns = 12,
  rowHeight = 92,
  gap = 16,
  editable = true,
  toolbar = true,
  resetNonce = 0,
  helperText = "Drag panels by the handle. Resize from the corner. Layout is saved on this device.",
  className = ""
}: EditableGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const lastResetNonce = useRef(resetNonce);
  const [layout, setLayout] = useState<Record<string, GridLayoutItem>>(() => loadLayout(storageKey, items));
  const [active, setActive] = useState<ActiveEdit | null>(null);
  const defaultLayout = useMemo(() => normalizeLayout(items), [items]);

  useEffect(() => {
    setLayout((current) => normalizeLayout(items, current));
  }, [items]);

  useEffect(() => {
    if (resetNonce !== lastResetNonce.current) {
      lastResetNonce.current = resetNonce;
      setLayout(defaultLayout);
    }
  }, [defaultLayout, resetNonce]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, storageKey]);

  useEffect(() => {
    if (!active) return;

    function move(event: PointerEvent) {
      const grid = gridRef.current;
      if (!grid) return;
      const cellWidth = (grid.clientWidth - gap * (columns - 1)) / columns;
      const stepX = Math.max(1, cellWidth + gap);
      const stepY = rowHeight + gap;
      const dx = Math.round((event.clientX - active.startX) / stepX);
      const dy = Math.round((event.clientY - active.startY) / stepY);

      setLayout((current) => {
        const currentItem = current[active.id];
        if (!currentItem) return current;
        const minW = currentItem.minW ?? 2;
        const minH = currentItem.minH ?? 2;
        const nextItem = active.mode === "move"
          ? {
              ...currentItem,
              x: clamp(active.start.x + dx, 0, columns - active.start.w),
              y: Math.max(0, active.start.y + dy)
            }
          : {
              ...currentItem,
              w: clamp(active.start.w + dx, minW, columns - active.start.x),
              h: Math.max(minH, active.start.h + dy)
            };
        return { ...current, [active.id]: nextItem };
      });
    }

    function stop() {
      setActive(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [active, columns, gap, rowHeight]);

  function startEdit(event: ReactPointerEvent, item: EditableGridItem, mode: ActiveEdit["mode"]) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const current = layout[item.id] ?? item;
    setActive({ id: item.id, mode, startX: event.clientX, startY: event.clientY, start: current });
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
    document.body.style.userSelect = "none";
  }

  const rows = Math.max(...items.map((item) => {
    const current = layout[item.id] ?? item;
    return current.y + current.h;
  }), 1);

  return <div className={className}>
    {editable && toolbar && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="text-sm text-slate-300">{helperText}</div>
      <button
        className="min-h-10 rounded-lg bg-white/10 px-3 text-sm text-slate-200 active:bg-white/20"
        onClick={() => setLayout(defaultLayout)}
      >
        <RotateCcw className="mr-2 inline h-4 w-4" />Reset grid
      </button>
    </div>}
    <div
      ref={gridRef}
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap,
        minHeight: rows * rowHeight + Math.max(0, rows - 1) * gap
      }}
    >
      {items.map((item) => {
        const current = layout[item.id] ?? item;
        return <section
          key={item.id}
          className="relative min-h-0"
          style={{
            gridColumn: `${current.x + 1} / span ${current.w}`,
            gridRow: `${current.y + 1} / span ${current.h}`
          }}
        >
          {editable && <button
            className="absolute right-11 top-2 z-20 grid h-8 w-8 cursor-grab place-items-center rounded-md border border-white/10 bg-slate-950/85 text-slate-200 shadow-lg active:cursor-grabbing"
            onPointerDown={(event) => startEdit(event, item, "move")}
            aria-label={`Move ${item.title}`}
            title={`Move ${item.title}`}
          >
            <Grip className="h-4 w-4" />
          </button>}
          <div className="h-full min-h-0 [&>.card]:h-full [&>.card]:min-h-0 [&>.card>div:last-child]:min-h-0 [&>.card>div:last-child]:overflow-auto">
            {item.content}
          </div>
          {editable && <button
            className="absolute bottom-2 right-2 z-20 grid h-8 w-8 cursor-nwse-resize place-items-center rounded-md border border-white/10 bg-slate-950/85 text-slate-200 shadow-lg"
            onPointerDown={(event) => startEdit(event, item, "resize")}
            aria-label={`Resize ${item.title}`}
            title={`Resize ${item.title}`}
          >
            <Maximize2 className="h-4 w-4" />
          </button>}
        </section>;
      })}
    </div>
  </div>;
}
