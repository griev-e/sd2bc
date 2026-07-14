"use client";

import { displayName } from "@/lib/format";
import { useTrip } from "@/lib/store";

/** Tiny colored initial dot showing who created/edited a record. */
export default function AttributionDot({
  userId,
  size = 16,
}: {
  userId: string | null;
  size?: number;
}) {
  const profiles = useTrip((s) => s.profiles);
  if (!userId) return null;
  const p = profiles.find((x) => x.id === userId);
  if (!p) return null;
  if (p.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={p.avatar_url}
        alt={displayName(p) ?? ""}
        title={displayName(p)}
        className="inline-block flex-shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, boxShadow: `0 0 0 1.5px ${p.color}` }}
      />
    );
  }
  return (
    <span
      title={displayName(p)}
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: p.color,
      }}
    >
      {(displayName(p) ?? "?").slice(0, 1)}
    </span>
  );
}
