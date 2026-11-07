"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import styles from "./board.module.css";

export function useNotice() {
  const [notice, setNotice] = useState<{ message: string; sequence: number } | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return { notice, notify: (message: string) => setNotice({ message, sequence: ++sequence.current }), dismiss: () => setNotice(null) };
}

export function Notice({ notice, dismiss }: Pick<ReturnType<typeof useNotice>, "notice" | "dismiss">) {
  return <div className={styles.noticeRegion} role="status" aria-live="polite" aria-atomic="true">
    {notice && <div className={styles.notice} key={notice.sequence}>
      <Check size={18} aria-hidden="true" /><span>{notice.message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notification"><X size={16} aria-hidden="true" /></button>
    </div>}
  </div>;
}

/** Animate only the results surface; filters and focused controls stay mounted. */
export function MotionResults({ changeKey, children }: { changeKey: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  const previous = useRef(changeKey);
  useEffect(() => {
    if (previous.current === changeKey) return;
    previous.current = changeKey;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !surface.current) return;
    const animation = surface.current.animate([
      { opacity: .65, transform: "translateY(3px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener("change", stop);
    return () => { animation.cancel(); preference.removeEventListener("change", stop); };
  }, [changeKey]);
  return <div ref={surface}>{children}</div>;
}

export function ListSkeleton({ label }: { label: string }) {
  return <div className={styles.listSkeleton} role="status" aria-label={label}>
    <span className={styles.visuallyHidden}>{label}</span>
    {[0, 1, 2].map(row => <div key={row} aria-hidden="true"><i /><span><b /><b /></span></div>)}
  </div>;
}
