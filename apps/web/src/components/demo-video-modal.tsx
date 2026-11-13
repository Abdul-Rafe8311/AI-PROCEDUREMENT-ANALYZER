'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const DemoVideoContext = createContext<{ openDemo: () => void }>({ openDemo: () => {} });

export function useDemoVideo() {
  return useContext(DemoVideoContext);
}

const EXIT_MS = 200;
const FOCUSABLE = 'button, [href], video[controls], [tabindex]:not([tabindex="-1"])';

export function DemoVideoProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false); // drives the fade/scale transition
  const triggerRef = useRef<HTMLElement | null>(null);

  const openDemo = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (closeTimer.current) return; // already closing
    setVisible(false); // play the 200ms fade+scale-out, then unmount
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      triggerRef.current?.focus?.();
    }, EXIT_MS);
  }, []);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const value = useMemo(() => ({ openDemo }), [openDemo]);

  return (
    <DemoVideoContext.Provider value={value}>
      {children}
      {open && <DemoModal visible={visible} setVisible={setVisible} onClose={close} />}
    </DemoVideoContext.Provider>
  );
}

function DemoModal({
  visible,
  setVisible,
  onClose,
}: {
  visible: boolean;
  setVisible: (v: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Enter transition, autoplay, focus, scroll lock.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const video = videoRef.current;
    if (video) {
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    }

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      if (video) {
        video.pause();
        video.currentTime = 0;
      }
    };
  }, [setVisible]);

  // Pause and rewind as soon as the exit transition starts.
  const shown = useRef(false);
  useEffect(() => {
    if (visible) {
      shown.current = true;
    } else if (shown.current && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [visible]);

  // Esc to close + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center px-4 transition-opacity duration-200 ease-out sm:px-6',
        'bg-black/70 backdrop-blur-sm',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Product demo video"
        className={cn(
          'relative aspect-video w-full max-w-[1180px] overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10',
          'transition duration-200 ease-out',
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
      >
        <video
          ref={videoRef}
          src="/demo/procurement-copilot-demo.mp4"
          poster="/demo/demo-poster.jpg"
          controls
          playsInline
          preload="none"
          className="h-full w-full bg-black object-contain"
        />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close demo video"
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function WatchDemoButton({ className }: { className?: string }) {
  const { openDemo } = useDemoVideo();
  return (
    <button type="button" onClick={openDemo} className={className}>
      <Play className="h-4 w-4 fill-current" />
      Watch the demo
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">1:20</span>
    </button>
  );
}
