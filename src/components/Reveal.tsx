"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Scroll reveals: content blocks fade up as they enter the viewport (styles in globals.css).
// Content is never hidden without this script: the root opt-in class is added only after blocks already on screen
// are marked revealed, so nothing flashes. Uses a data attribute (not className) because React owns className and
// would wipe an added class on re-render.
const TARGETS = ".lp-head, .lp-step, .lp-ask, .lp-card, .lp-trust, .lp-foot .lp-inner, .ct-build, .ct-cat, .app-row, .kp-panel";
const STAGGER_MAX = 6;

export default function Reveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.revealed = "1";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    // This sits in its own Suspense boundary, so it can run before the page's own markup has hydrated. Touching an
    // element's attributes before then is a hydration mismatch; wait a frame for React to claim it.
    const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    let frame = 0;
    const track = (el: Element, tries = 0) => {
      const h = el as HTMLElement;
      if (h.dataset.revealed) return;
      if (!hydrated(h) && tries < 60) {
        frame = requestAnimationFrame(() => track(h, tries + 1));
        return;
      }
      if (!h.dataset.revealTracked) {
        h.dataset.revealTracked = "1";
        // stagger siblings of the same kind (steps, rows) by their position
        const same = Array.from(h.parentElement?.children ?? []).filter((c) => c.matches(TARGETS));
        h.style.setProperty("--reveal-i", String(Math.min(same.indexOf(h), STAGGER_MAX)));
      }
      // (re)checked on every run, so a block tracked by a previous page's observer is never left hidden
      if (h.getBoundingClientRect().top < innerHeight * 0.92) h.dataset.revealed = "1"; // already on screen: no flash
      else io.observe(h);
    };
    document.querySelectorAll(TARGETS).forEach((el) => track(el));
    root.classList.add("reveal-ready");
    // blocks that mount later (loaded data, new panels) join in
    const mo = new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(TARGETS)) track(n);
          n.querySelectorAll(TARGETS).forEach((el) => track(el));
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
