'use client';

/**
 * Client staging for the landing page. Three primitives, no library.
 *
 * Scene marks itself `is-on` when scrolled into view and landing.css does the
 * choreography. CountUp runs a figure from zero when it becomes visible.
 * BurnCounter ticks the write-off total in real time while the page is open.
 *
 * All three respect prefers-reduced-motion: Scene still fires (the CSS
 * transitions collapse to nothing under the global rule), CountUp snaps to its
 * final value, and BurnCounter updates once a second instead of every frame.
 * Without JavaScript the page renders complete and static: Scene and CountUp
 * server-render their final content, and a noscript rule in the page unhides
 * everything the scenes would have revealed.
 */

import { useEffect, useRef, type ReactNode } from 'react';

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
    <section ref={ref} className={className ? `ld-scene ${className}` : 'ld-scene'}>
      {children}
    </section>
  );
}

export function CountUp({
  to,
  prefix = '',
  suffix = '',
  duration = 1800,
  className,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    el.textContent = `${prefix}0${suffix}`;
    let raf = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - (1 - t) ** 3;
            el.textContent = `${prefix}${Math.round(to * eased).toLocaleString('en-US')}${suffix}`;
            if (t < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, prefix, suffix, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {to.toLocaleString('en-US')}
      {suffix}
    </span>
  );
}

export function BurnCounter({
  ratePerSecond,
  className,
}: {
  ratePerSecond: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = performance.now();
    const render = (now: number) => {
      const dollars = Math.floor(((now - start) / 1000) * ratePerSecond);
      el.textContent = `$${dollars.toLocaleString('en-US')}`;
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const id = window.setInterval(() => render(performance.now()), 1000);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    const tick = (now: number) => {
      render(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ratePerSecond]);

  return (
    <span ref={ref} className={className}>
      $0
    </span>
  );
}
