"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** e.g. "70dvh" — content scrolls inside */
  maxHeight?: string;
}

/** iOS-style spring bottom sheet rendered above the tab bar. */
export default function Sheet({ open, onClose, title, children, maxHeight = "82dvh" }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="glass-strong fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md flex-col rounded-t-3xl border-b-0"
            style={{ maxHeight }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 500) onClose();
            }}
          >
            <div className="flex items-center justify-center pb-1 pt-3">
              <div className="h-1 w-9 rounded-full bg-fg-faint/40" />
            </div>
            {title && (
              <div className="flex items-center justify-between px-5 pb-1 pt-1">
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="pressable flex h-8 w-8 items-center justify-center rounded-full bg-fg/5 text-fg-muted"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14">
                    <path
                      d="M2 2l10 10M12 2 2 12"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-safe">
              <div className="pb-6">{children}</div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
