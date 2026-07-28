"use client";

import Sheet from "./Sheet";
import { IconPin } from "./Icons";
import type { NavOption } from "@/lib/directions";

/**
 * Bottom sheet to pick which navigation app takes over. Shared by the day
 * cards (hand off the whole day's drive) and the Today panel (just the next
 * stop), so the choice reads the same wherever you tap it.
 */
export default function NavAppSheet({
  title,
  options,
  open,
  onClose,
  /** Set when the links carry only one destination, not the whole day. */
  singleStop = false,
}: {
  title: string;
  options: NavOption[];
  open: boolean;
  onClose: () => void;
  singleStop?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-2">
        {options.map((opt) => (
          <a
            key={opt.provider}
            href={opt.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="pressable flex items-center gap-3 rounded-xl bg-fg/[0.03] px-4 py-3.5 text-sm font-semibold"
          >
            <IconPin size={16} className="text-fg-faint" />
            {opt.label}
          </a>
        ))}
      </div>
      <p className="mt-3 px-1 text-[11px] leading-relaxed text-fg-faint">
        {singleStop
          ? "Every app routes to this one stop from wherever you are."
          : "Google Maps follows every stop in order. Apple Maps chains the stops too; Waze navigates to the last stop from where you are."}
      </p>
    </Sheet>
  );
}
