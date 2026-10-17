'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes the element it sits in an accessible modal, without restructuring it.
 *
 * The app has ~25 hand-built overlays (`fixed inset-0` + backdrop + panel). Rewriting each
 * into a shared <Modal> would touch every one of their layouts; dropping this as the FIRST
 * CHILD of the overlay gives them all the same behaviour (WCAG 2.1.2, 2.4.3, 4.1.2):
 *  - role="dialog", aria-modal and a name (`label`) on the overlay;
 *  - focus moves in on open, Tab cycles inside, Escape calls onClose;
 *  - focus returns to the opener when the overlay unmounts.
 * The key listener is on the overlay itself, so a nested dialog handles its own Escape.
 */
export function DialogA11y({ label, onClose }: { label: string; onClose: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const opener = document.activeElement as HTMLElement | null;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', label);
    const items = () => Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (!host.contains(document.activeElement)) {
      const first = items()[0];
      if (first) first.focus({ preventScroll: true });
      else { host.setAttribute('tabindex', '-1'); host.focus({ preventScroll: true }); }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const list = items();
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === host)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    host.addEventListener('keydown', onKey);
    return () => {
      host.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  // The label may change while open (a modal retitled mid-flow); the behaviour must not re-run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { ref.current?.parentElement?.setAttribute('aria-label', label); }, [label]);

  return <span ref={ref} hidden />;
}
