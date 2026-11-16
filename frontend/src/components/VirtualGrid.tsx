import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { estimateTileHeight, laneGeometry, laneLeft, nearEnd, recallGrid, rememberGrid } from "../lib/grid";

/**
 * Masonry grid that only renders tiles near the screen (window scrolling). Tiles go into the
 * shortest column, are measured once rendered, and the scroll position and sizes are remembered
 * per `memoryKey` so coming back to the page lands where you were.
 */
export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  onNearEnd,
  memoryKey,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  onNearEnd?: () => void;
  memoryKey?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [top, setTop] = useState(0);
  const remembered = memoryKey ? recallGrid(memoryKey) : undefined;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => {
      setWidth(el.clientWidth);
      setTop(el.getBoundingClientRect().top + window.scrollY);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = laneGeometry(width || 343);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateTileHeight(g.itemWidth),
    lanes: g.lanes,
    overscan: 4,
    scrollMargin: top,
    getItemKey: (i) => getKey(items[i]!),
    laneAssignmentMode: "measured",
  });
  const rows = virtualizer.getVirtualItems();
  const last = rows.length ? rows[rows.length - 1]!.index : -1;

  useEffect(() => {
    if (onNearEnd && nearEnd(last, items.length, g.lanes)) onNearEnd();
  }, [last, items.length, g.lanes, onNearEnd]);

  // Remember where we were, for coming back to this page. Recorded while scrolling: by the time
  // an unmount cleanup runs, the page has already shrunk and the browser has clamped scrollY.
  useEffect(() => {
    if (!memoryKey) return;
    let timer = 0;
    const save = () => {
      timer = 0;
      rememberGrid(memoryKey, window.scrollY, []);
    };
    const onScroll = () => {
      if (!timer) timer = window.setTimeout(save, 120);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [memoryKey, virtualizer]);

  // Restore the scroll position once the grid has its width and items. Tiles are estimated
  // before they're measured, so nudge again shortly after while they settle.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !remembered || !items.length || !width) return;
    restored.current = true;
    const target = remembered.offset;
    window.scrollTo(0, target);
    const again = window.setTimeout(() => window.scrollTo(0, target), 150);
    return () => window.clearTimeout(again);
  }, [remembered, items.length, width]);

  return (
    <div ref={wrap} className="relative w-full" style={{ height: virtualizer.getTotalSize() - top || undefined }}>
      {width > 0 &&
        rows.map((row) => (
          <div
            key={row.key as string | number}
            data-index={row.index}
            data-tile
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0"
            style={{ width: g.itemWidth, transform: `translate(${laneLeft(row.lane, g)}px, ${row.start - top}px)` }}
          >
            {renderItem(items[row.index]!, row.index)}
          </div>
        ))}
    </div>
  );
}
