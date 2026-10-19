"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** A touch-scrollable shelf with keyboard-accessible controls when it overflows. */
export function HomeShelf({ label, children, variant = "posters" }: { label: string; children: React.ReactNode; variant?: "posters" | "continue" }) {
  const id = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => setEdges({ previous: row.scrollLeft > 2, next: row.scrollLeft + row.clientWidth < row.scrollWidth - 2 });
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => { row.removeEventListener("scroll", update); observer.disconnect(); };
  }, [children]);

  function scroll(direction: number) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * .85, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  return (
    <div className={`home-shelf home-shelf--${variant}`}>
      <div id={id} ref={rowRef} className="home-shelf-row" tabIndex={0} role="region" aria-label={`${label} titles`}>{children}</div>
      {edges.previous && <button className="home-shelf-arrow previous" aria-label={`Scroll ${label} left`} aria-controls={id} onClick={() => scroll(-1)}><ChevronLeft /></button>}
      {edges.next && <button className="home-shelf-arrow next" aria-label={`Scroll ${label} right`} aria-controls={id} onClick={() => scroll(1)}><ChevronRight /></button>}
    </div>
  );
}
