'use client';

/**
 * Client staging for the landing page. Two primitives, no library.
 *
 * Cinescape is the fixed backdrop the whole page scrolls over: a volumetric
 * light shaft, denial letters adrift at three depths, film grain, vignette.
 * The papers are generated after mount, deterministically, so the server
 * renders an empty stage and hydration has nothing to disagree with; the
 * scene is decoration and is hidden from assistive tech entirely.
 *
 * Scene marks itself `is-on` when scrolled into view and landing.css does the
 * choreography. Both respect prefers-reduced-motion: the CSS transitions and
 * the paper drift collapse to nothing under the global rule, and without
 * JavaScript a noscript rule in the page unhides everything.
 */

import { useEffect, useRef, type ReactNode } from 'react';

/** Deterministic, so every visit is the same film. */
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Cinescape() {
  const holder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const r = rng(20260417);
    const W = window.innerWidth;
    const H = window.innerHeight;

    // How lit a point is: distance from the beam cone widening toward the
    // floor. Papers outside it fade toward the dark.
    const light = (x: number, y: number) => {
      const half = 120 + (y / H) * 420;
      const d = Math.abs(x - W * 0.5) / half;
      return Math.max(0, 1 - d * d);
    };

    // Three depths. The backdrop is fixed while the page scrolls over it, so
    // the sharp near papers keep to the edges and everything allowed near the
    // middle is dim and blurred enough to sit behind text without fighting it.
    const layers = [
      { n: Math.round(W / 42), s: [0.22, 0.5], blur: [5, 9], dim: 0.22, edges: false },
      { n: Math.round(W / 72), s: [0.5, 0.85], blur: [2.2, 4.5], dim: 0.5, edges: false },
      { n: Math.round(W / 160), s: [0.9, 1.35], blur: [0, 1.2], dim: 0.95, edges: true },
    ];

    const frag = document.createDocumentFragment();

    for (const layer of layers) {
      for (let i = 0; i < layer.n; i += 1) {
        let x = r() * W;
        const y = r() * H;
        // Half the drifting papers fall inside the light, where the story is.
        if (!layer.edges && r() < 0.5) {
          const half = 120 + (y / H) * 420;
          x = W * 0.5 + (r() - 0.5) * half * 1.6;
        }
        const s = layer.s[0]! + r() * (layer.s[1]! - layer.s[0]!);
        const pw = 92 * s;
        const ph = 122 * s;

        // The middle column belongs to words at every scroll position.
        const inCenter = x + pw > W * 0.2 && x < W * 0.8 && y + ph > H * 0.22 && y < H * 0.95;
        if (layer.edges && inCenter) continue;
        if (!layer.edges && layer.dim > 0.3 && inCenter) continue;

        const lit = light(x, y);
        let o = Math.min(1, (0.06 + lit * 0.95) * layer.dim);
        if (y < H * 0.3) o = Math.min(o, 0.55);
        if (o < 0.045) continue;

        const p = document.createElement('div');
        p.className = 'cine-paper';
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.width = `${pw}px`;
        p.style.height = `${ph}px`;
        p.style.opacity = o.toFixed(3);
        p.style.filter = `blur(${(layer.blur[0]! + r() * (layer.blur[1]! - layer.blur[0]!)).toFixed(1)}px)`;
        p.style.setProperty('--rot', `${(r() * 56 - 28).toFixed(1)}deg`);
        p.style.setProperty('--dur', `${(70 + r() * 70).toFixed(0)}s`);
        p.style.setProperty('--delay', `-${(r() * 70).toFixed(0)}s`);
        p.innerHTML =
          '<span class="cine-paper-head"></span><span class="cine-paper-lines"></span>' +
          (layer.dim > 0.6 && r() < 0.75 ? '<span class="cine-paper-stamp"></span>' : '');
        frag.appendChild(p);
      }
    }

    el.appendChild(frag);
    return () => {
      el.textContent = '';
    };
  }, []);

  return (
    <div className="cine-bg" aria-hidden="true">
      <div className="cine-beam-wide" />
      <div className="cine-beam-core" />
      <div className="cine-floor-glow" />
      <div ref={holder} />
      <div className="cine-vignette" />
      <div className="cine-grain" />
    </div>
  );
}

export function Scene({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-on');
            observer.disconnect();
          }
        }
      },
      // Fire when the scene's top clears the bottom quarter of the viewport,
      // rather than a ratio threshold, so scenes taller than the screen still
      // trigger.
      { rootMargin: '0px 0px -25% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className={className ? `cine-scene ${className}` : 'cine-scene'}>
      {children}
    </section>
  );
}
