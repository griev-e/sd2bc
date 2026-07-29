"use client";

import Sheet from "./Sheet";
import { IconPin } from "./Icons";
import type { NavOption } from "@/lib/directions";

/**
 * Bottom sheet to pick which navigation app takes over. Shared by the day
 * cards (hand off the whole day's drive) and the Today panel (just the next
 * stop), so the choice reads the same wherever you tap it.
 *
 * Each row says where that app will ACTUALLY take you. Only Google Maps can
 * follow a multi-stop day by URL — Apple Maps and Waze have no waypoint
 * parameter — and a sheet that implies otherwise is how you end up on the
 * freeway past the thing you drove out here to see.
 */
export default function NavAppSheet({
  title,
  options,
  /** Place names aligned to the point list the options were built from. */
  names,
  open,
  onClose,
}: {
  title: string;
  options: NavOption[];
  names?: string[];
  open: boolean;
  onClose: () => void;
}) {
  /** How many real stops this link covers (everything after the origin). */
  const stopCount = names ? Math.max(0, names.length - 1) : 0;

  function detailFor(opt: NavOption): string {
    const target = names?.[opt.targetIndex];
    if (opt.multiStop) {
      if (stopCount <= 1) return target ? `To ${target}` : "To the day's last stop";
      return `All ${stopCount} stops in order`;
    }
    return target ? `Next stop only · ${target}` : "Next stop only";
  }

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
            className="pressable flex items-center gap-3 rounded-xl bg-fg/[0.03] px-4 py-3 text-left"
          >
            <IconPin size={16} className="flex-shrink-0 text-fg-faint" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{opt.label}</span>
              <span
                className={`mt-0.5 block truncate text-[11px] ${
                  opt.multiStop && stopCount > 1 ? "text-accent" : "text-fg-faint"
                }`}
              >
                {detailFor(opt)}
              </span>
            </span>
          </a>
        ))}
      </div>
      {stopCount > 1 && (
        <p className="mt-3 px-1 text-[11px] leading-relaxed text-fg-faint">
          Only Google Maps can be handed a whole day in a link. Apple Maps and
          Waze have no way to accept the stops in between, so they take you to
          the next one — open them again when you get there.
        </p>
      )}
    </Sheet>
  );
}
