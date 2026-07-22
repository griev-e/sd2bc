"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import AttributionDot from "@/components/Attribution";
import CheckPill from "@/components/CheckPill";
import CountdownPill from "@/components/CountdownPill";
import { IconPlus, IconX } from "@/components/Icons";
import Sheet from "@/components/Sheet";
import { displayName } from "@/lib/format";
import { FADE, riseIn, SPRING } from "@/lib/motion";
import { useTrip } from "@/lib/store";

type AssignFilter = "all" | "me" | "partner" | "shared";

const CATEGORY_DOT = [
  "var(--accent)",
  "var(--coral)",
  "var(--gold)",
  "var(--sky)",
  "var(--violet)",
  "var(--indigo)",
];

export default function PackingPage() {
  const packing = useTrip((s) => s.packing);
  const profiles = useTrip((s) => s.profiles);
  const userId = useTrip((s) => s.userId);
  const togglePacking = useTrip((s) => s.togglePacking);
  const addPackingItem = useTrip((s) => s.addPackingItem);
  const updatePackingItem = useTrip((s) => s.updatePackingItem);
  const deletePackingItem = useTrip((s) => s.deletePackingItem);

  const partner = profiles.find((p) => p.id !== userId) ?? null;
  const [filter, setFilter] = useState<AssignFilter>("all");
  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState("Clothes");
  const [newAssign, setNewAssign] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return packing.filter((p) => {
      if (filter === "all") return true;
      if (filter === "me") return p.assigned_to === userId;
      if (filter === "partner") return partner !== null && p.assigned_to === partner.id;
      return p.assigned_to === null;
    });
  }, [packing, filter, userId, partner]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof packing>();
    for (const item of [...filtered].sort((a, b) => a.seq - b.seq)) {
      const list = m.get(item.category) ?? [];
      list.push(item);
      m.set(item.category, list);
    }
    return [...m.entries()];
  }, [filtered]);

  const categories = useMemo(
    () => [...new Set(packing.map((p) => p.category))],
    [packing],
  );

  const done = packing.filter((p) => p.checked).length;
  const pct = packing.length ? done / packing.length : 0;

  // One spring drives both the bar and the "67%" label so they move together
  // (MotionValue springs bypass MotionConfig, hence the explicit jump).
  const reduced = useReducedMotion();
  const pctSpring = useSpring(pct, { stiffness: 520, damping: 44 }); // SPRING's params
  useEffect(() => {
    if (reduced) pctSpring.jump(pct);
    else pctSpring.set(pct);
  }, [pct, reduced, pctSpring]);
  const pctText = useTransform(pctSpring, (v) => `${Math.round(v * 100)}%`);

  // One celebratory gradient sweep when packing crosses into 100% — only on a
  // live crossing, never just because the page loaded already complete.
  const prevPct = useRef(pct);
  const [sweep, setSweep] = useState(false);
  useEffect(() => {
    if (pct === 1 && prevPct.current < 1) setSweep(true);
    prevPct.current = pct;
  }, [pct]);

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">
                {done}/{packing.length} packed
              </p>
              <h1 className="display mt-0.5 text-[22px] tracking-tight">Packing</h1>
            </div>
            <CountdownPill />
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fg/5">
              {/* scaleX instead of width — transform-only, springs smoothly */}
              <motion.div
                className="h-full w-full origin-left rounded-full"
                style={{ scaleX: pctSpring, background: "var(--accent-gradient)" }}
              />
              <AnimatePresence>
                {sweep && (
                  <motion.div
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{ duration: 0.9, ease: "easeInOut", delay: 0.25 }}
                    onAnimationComplete={() => setSweep(false)}
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.6) 50%, transparent 70%)",
                    }}
                  />
                )}
              </AnimatePresence>
            </div>
            <motion.span className="mono text-xs font-semibold text-fg-muted">
              {pctText}
            </motion.span>
          </div>
        </div>
      </header>

      <div className="px-4 pt-3">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
          {(
            [
              ["all", "Everything"],
              ["me", "Mine"],
              ["partner", displayName(partner) ?? "Theirs"],
              ["shared", "Shared"],
            ] as [AssignFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`pressable relative flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors duration-200 ${
                filter === key ? "text-accent-contrast" : "glass text-fg-muted"
              }`}
            >
              {/* one pill shared by the group — layoutId slides it to the pick */}
              {filter === key && (
                <motion.span
                  layoutId="packing-filter-pill"
                  transition={SPRING}
                  className="btn-primary absolute inset-0 rounded-full"
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
          <button
            onClick={() => setEditMode(!editMode)}
            className={`pressable ml-auto flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
              editMode ? "bg-fg text-bg" : "glass text-fg-muted"
            }`}
          >
            {editMode ? "Done" : "Edit"}
          </button>
        </div>

        <div className="space-y-3.5">
          <AnimatePresence>
          {groups.map(([category, items], gi) => (
            <motion.section
              key={category}
              layout="position"
              {...riseIn(gi)}
              transition={{ ...riseIn(gi).transition, layout: SPRING }}
              exit={{ opacity: 0, transition: FADE }}
              className="card p-4"
            >
              <p className="eyebrow mb-2 flex items-center gap-1.5 px-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: CATEGORY_DOT[gi % CATEGORY_DOT.length] }}
                />
                {category}
              </p>
              {/* popLayout: a deleted row pops out and fades while the rows
                  below slide up — matches the optimistic delete in the store */}
              <div className="relative">
                <AnimatePresence initial={false} mode="popLayout">
                {items.map((item) => (
                  <motion.label
                    key={item.id}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ ...FADE, layout: SPRING }}
                    className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl px-1.5 py-1 active:bg-fg/5"
                  >
                    <CheckPill
                      checked={item.checked}
                      onChange={(checked) => void togglePacking(item.id, checked)}
                    />
                    <span
                      className={`flex-1 text-sm transition-colors duration-200 ${
                        item.checked ? "text-fg-faint" : "font-medium"
                      }`}
                    >
                      {/* strike-through sweeps across the label instead of
                          appearing — sized by this inner span, not the flex cell */}
                      <span className="relative">
                        {item.label}
                        <motion.span
                          aria-hidden
                          initial={false}
                          animate={{ scaleX: item.checked ? 1 : 0 }}
                          transition={{ duration: 0.25, ease: "easeOut" }}
                          className="absolute inset-x-0 top-1/2 h-px origin-left bg-current"
                        />
                      </span>
                    </span>
                    {item.assigned_to && (
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                        {displayName(profiles.find((p) => p.id === item.assigned_to)) ?? "?"}
                      </span>
                    )}
                    {item.checked && <AttributionDot userId={item.checked_by} size={16} />}
                    {editMode && (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            const order: (string | null)[] = [null, userId, partner?.id ?? null];
                            const cur = order.indexOf(item.assigned_to);
                            const next = order[(cur + 1) % order.length];
                            void updatePackingItem(item.id, { assigned_to: next });
                          }}
                          className="btn-ghost pressable rounded-lg px-2 py-1.5 text-[10px] font-semibold"
                        >
                          assign
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            void deletePackingItem(item.id);
                          }}
                          aria-label="Delete item"
                          className="pressable rounded-lg px-2 py-1.5 text-danger"
                        >
                          <IconX size={12} />
                        </button>
                      </span>
                    )}
                  </motion.label>
                ))}
                </AnimatePresence>
              </div>
            </motion.section>
          ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Motion owns this button's transform (entrance + press), so no
          .pressable — its :active transform would be overridden anyway */}
      <motion.button
        onClick={() => setAddOpen(true)}
        aria-label="Add item"
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...SPRING, delay: 0.15 }}
        whileTap={{ scale: 0.88 }}
        className="btn-primary fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl"
      >
        <IconPlus size={20} />
      </motion.button>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add item">
        <div className="space-y-4">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="What are we bringing?"
            autoFocus
            className="field"
          />
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {[...new Set([...categories, "Other"])].map((c) => (
              <button
                key={c}
                onClick={() => setNewCategory(c)}
                className={`pressable flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
                  newCategory === c ? "btn-primary" : "border border-hairline text-fg-muted"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(
              [
                [null, "Shared"],
                [userId, "Me"],
                [partner?.id ?? "none", displayName(partner) ?? "Partner"],
              ] as [string | null, string][]
            ).map(([id, label]) => (
              <button
                key={label}
                disabled={id === "none"}
                onClick={() => setNewAssign(id)}
                className={`pressable flex-1 rounded-xl py-2.5 text-xs font-semibold disabled:opacity-40 ${
                  newAssign === id ? "btn-primary" : "border border-hairline text-fg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            disabled={!newLabel.trim()}
            onClick={() => {
              void addPackingItem(newCategory, newLabel.trim(), newAssign);
              setNewLabel("");
              setAddOpen(false);
            }}
            className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-40"
          >
            Add to list
          </button>
        </div>
      </Sheet>
    </div>
  );
}
