'use client';

import { type ReactNode, useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion';

/**
 * Scroll-driven "device reveal" — the screen tilts up and scales toward the
 * viewer as it scrolls into view (inspired by the Aceternity Macbook Scroll).
 * Respects prefers-reduced-motion.
 */
export function MacbookScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'center center'],
  });

  const rotateX = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [22, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.88, 1]);
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [48, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.35], reduce ? [1, 1] : [0.45, 1]);

  return (
    <div ref={ref} className="mx-auto max-w-5xl [perspective:1600px]">
      <motion.div
        style={{ rotateX, scale, y, opacity, transformOrigin: 'center top' }}
        className="relative"
      >
        {/* ambient glow */}
        <div className="pointer-events-none absolute -inset-x-12 -top-14 -z-10 h-44 rounded-full bg-primary/20 blur-3xl" />

        {/* screen */}
        <div className="relative rounded-2xl border border-border bg-card p-2 shadow-2xl shadow-primary/10">
          {/* camera dot */}
          <div className="absolute left-1/2 top-1.5 h-1 w-1 -translate-x-1/2 rounded-full bg-muted-foreground/40" />
          <div className="overflow-hidden rounded-xl">{children}</div>
        </div>

        {/* laptop base / hinge */}
        <div className="relative mx-auto h-3 w-[103%] -translate-x-[1.5%] rounded-b-xl border-x border-b border-border bg-gradient-to-b from-muted to-accent">
          <div className="absolute left-1/2 top-0 h-1 w-24 -translate-x-1/2 rounded-b-md bg-muted-foreground/20" />
        </div>
      </motion.div>
    </div>
  );
}
