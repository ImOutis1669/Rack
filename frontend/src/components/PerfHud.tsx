import { useEffect, useRef, useState } from "react";
import { frameStats, type FrameStats } from "../lib/perf";

/**
 * Small on-screen readout for measuring on the iPhone (?perf=1): time to the first tile and its
 * first photo, tiles in the page, and frame times during the last scroll.
 */
export function PerfHud() {
  const [firstTile, setFirstTile] = useState<number | null>(null);
  const [firstPhoto, setFirstPhoto] = useState<number | null>(null);
  const [tiles, setTiles] = useState(0);
  const [scroll, setScroll] = useState<FrameStats | null>(null);
  const gaps = useRef<number[]>([]);

  useEffect(() => {
    const count = () => {
      const n = document.querySelectorAll("main article, main [data-tile]").length;
      setTiles(n);
      if (n > 0) setFirstTile((t) => t ?? Math.round(performance.now()));
    };
    const mo = new MutationObserver(count);
    mo.observe(document.body, { childList: true, subtree: true });
    count();
    const onLoad = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "IMG" && el.closest("main article, main [data-tile]")) setFirstPhoto((t) => t ?? Math.round(performance.now()));
    };
    document.addEventListener("load", onLoad, true);

    let frame = 0;
    let last = 0;
    let idle = 0;
    const tick = (t: number) => {
      if (last) gaps.current.push(t - last);
      last = t;
      frame = requestAnimationFrame(tick);
    };
    const onScroll = () => {
      if (!frame) {
        gaps.current = [];
        last = 0;
        frame = requestAnimationFrame(tick);
      }
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        cancelAnimationFrame(frame);
        frame = 0;
        setScroll(frameStats(gaps.current));
      }, 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      mo.disconnect();
      document.removeEventListener("load", onLoad, true);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="tabular pointer-events-none fixed top-[calc(env(safe-area-inset-top)+60px)] right-2 z-[70] rounded-photo bg-black/75 px-2.5 py-1.5 font-mono text-[10px] leading-tight text-white"
    >
      <div>first tile {firstTile ?? "–"} ms</div>
      <div>first photo {firstPhoto ?? "–"} ms</div>
      <div>tiles {tiles}</div>
      {scroll ? (
        <div>
          scroll {scroll.fps} fps · med {scroll.median} · p95 {scroll.p95} · drop {scroll.dropped}/{scroll.frames}
        </div>
      ) : (
        <div>scroll: scroll to measure</div>
      )}
    </div>
  );
}
