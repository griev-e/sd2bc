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
import {
  AUTO_TAG_THRESHOLD,
  categoryMeta,
  detectAssignee,
  nameAliases,
  OTHER_CATEGORY,
  PACKING_CATEGORIES,
  PARTNER_ALIASES,
  parsePackingEntries,
  SELF_ALIASES,
  suggestCategory,
  suggestRetags,
  type TagPerson,
} from "@/lib/packingTags";
import { useTrip } from "@/lib/store";
import { bySeq, type PackingItem, type Profile } from "@/lib/types";

type AssignFilter = "all" | "me" | "partner" | "shared";

/** Small tinted tag chip — the same color the category's dot uses in the list. */
function CategoryPill({ category }: { category: string }) {
  const meta = categoryMeta(category);
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <span aria-hidden>{meta.emoji}</span>
      {category}
    </span>
  );
}

/** Names this person answers to in an item label: "Kev's charger", "my hat". */
function aliasesFor(profile: Profile | null, pronouns: string[]): string[] {
  // Longest first, so "kevin's" is consumed as a whole rather than as "kev".
  const names = nameAliases(displayName(profile)).sort((a, b) => b.length - a.length);
  return [...new Set([...names, ...pronouns])];
}

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
  /** Manual category override — null means "whatever auto-tagging says". */
  const [pinnedCategory, setPinnedCategory] = useState<string | null>(null);
  const [newAssign, setNewAssign] = useState<string | null>(null);
  /** Same idea for the assignment: only pinned once it's been tapped. */
  const [assignPinned, setAssignPinned] = useState(false);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [tidySkipped, setTidySkipped] = useState<string[]>([]);

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
    for (const item of [...filtered].sort(bySeq)) {
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

  const people = useMemo<TagPerson[]>(() => {
    const me = profiles.find((p) => p.id === userId) ?? null;
    const list: TagPerson[] = [];
    if (userId) list.push({ id: userId, aliases: aliasesFor(me, SELF_ALIASES) });
    if (partner) list.push({ id: partner.id, aliases: aliasesFor(partner, PARTNER_ALIASES) });
    return list;
  }, [profiles, userId, partner]);

  /**
   * What we'd add if you hit the button right now. One draft per typed entry
   * (a pasted list splits into several), each with its own auto-tag and any
   * owner read out of the text. Recomputed per keystroke — the classifier is
   * pure and local, so that's free.
   */
  const drafts = useMemo(() => {
    return parsePackingEntries(newLabel).map((entry) => {
      const owned = detectAssignee(entry, people);
      const suggestion = suggestCategory(owned.label, { items: packing, categories });
      const auto =
        suggestion.confidence >= AUTO_TAG_THRESHOLD ? suggestion.category : OTHER_CATEGORY;
      return {
        label: owned.label,
        detectedAssignee: owned.assignedTo,
        suggestion,
        category: pinnedCategory ?? auto,
      };
    });
  }, [newLabel, people, packing, categories, pinnedCategory]);

  const lead = drafts[0] ?? null;
  const assignTo = assignPinned ? newAssign : (lead?.detectedAssignee ?? null);
  // With several drafts in flight each keeps its own tag, so no chip is lit
  // unless you've pinned one — which applies to all of them.
  const activeCategory = pinnedCategory ?? (drafts.length === 1 ? (lead?.category ?? null) : null);

  /** Category chips: what we suggest, what the list already has, then the rest. */
  const chipOptions = useMemo(() => {
    const suggested = lead && lead.suggestion.confidence >= AUTO_TAG_THRESHOLD
      ? [lead.suggestion.category]
      : [];
    return [...new Set([...suggested, ...categories, ...PACKING_CATEGORIES, OTHER_CATEGORY])];
  }, [lead, categories]);

  /**
   * Items the classifier is confident are in the wrong section. Only computed
   * while editing — it's a full pass over the list.
   */
  const retags = useMemo(
    () => (editMode ? suggestRetags(packing).filter((r) => !tidySkipped.includes(r.item.id)) : []),
    [editMode, packing, tidySkipped],
  );

  // Grow the entry field with a pasted list instead of hiding it behind a
  // one-line scroll, up to a cap so the sheet never eats the keyboard.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 46), 132)}px`;
  }, [newLabel, addOpen]);

  const resetDraft = () => {
    setNewLabel("");
    setPinnedCategory(null);
    setNewAssign(null);
    setAssignPinned(false);
  };

  const commitDrafts = () => {
    for (const draft of drafts) {
      const owner = assignPinned ? newAssign : draft.detectedAssignee;
      void addPackingItem(draft.category, draft.label, owner);
    }
    resetDraft();
    setAddOpen(false);
  };

  /** Apply a batch of re-file proposals, giving each item a fresh tail `seq`. */
  const applyRetags = (moves: { item: PackingItem; to: string }[]) => {
    const tails = new Map<string, number>();
    for (const item of packing) {
      tails.set(item.category, Math.max(tails.get(item.category) ?? 0, item.seq));
    }
    for (const { item, to } of moves) {
      // max + 1 within the destination, same rule the store uses on insert
      const seq = (tails.get(to) ?? 0) + 1;
      tails.set(to, seq);
      void updatePackingItem(item.id, { category: to, seq });
    }
    setTidyOpen(false);
  };

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
            onClick={() => {
              if (!editMode) setTidySkipped([]); // a fresh pass each time
              setEditMode(!editMode);
            }}
            className={`pressable ml-auto flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
              editMode ? "bg-fg text-bg" : "glass text-fg-muted"
            }`}
          >
            {editMode ? "Done" : "Edit"}
          </button>
        </div>

        {/* Its own row rather than another filter pill — the pill row already
            scrolls, and "Done" must never be pushed out of reach. */}
        <AnimatePresence initial={false}>
          {retags.length > 0 && (
            <motion.button
              key="tidy"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={FADE}
              onClick={() => setTidyOpen(true)}
              className="pressable mb-3 flex w-full items-center gap-2 rounded-2xl border border-hairline px-3.5 py-2.5"
            >
              <span aria-hidden>✨</span>
              <span className="flex-1 text-left text-xs font-medium text-fg-muted">
                {retags.length} {retags.length === 1 ? "item looks" : "items look"} mis-tagged
              </span>
              <span className="text-xs font-semibold text-accent">Review</span>
            </motion.button>
          )}
        </AnimatePresence>

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
                {/* color and glyph come from what the category *means*, so
                    "Bathroom" and "Toiletries" read as the same shelf */}
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: categoryMeta(category).fg }}
                />
                <span aria-hidden>{categoryMeta(category).emoji}</span>
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
          {/* textarea, not input: a pasted checklist keeps its line breaks and
              becomes one row per line. Enter still means "add". */}
          <textarea
            ref={inputRef}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && drafts.length > 0) {
                e.preventDefault();
                commitDrafts();
              }
            }}
            rows={1}
            placeholder="What are we bringing? Paste a whole list if you like."
            autoFocus
            className="field no-scrollbar block resize-none leading-[22px]"
            style={{ height: 46, paddingTop: 11, paddingBottom: 11 }}
          />

          <AnimatePresence initial={false} mode="popLayout">
            {drafts.length === 1 && lead && (
              <motion.div
                key="single"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={FADE}
                className="flex items-center gap-2"
              >
                <CategoryPill category={lead.category} />
                <p className="text-[11px] text-fg-muted">
                  {pinnedCategory
                    ? "your pick"
                    : lead.suggestion.confidence < AUTO_TAG_THRESHOLD
                      ? "not sure — pick a tag"
                      : lead.suggestion.source === "learned"
                        ? "auto · matches your list"
                        : "auto-tagged"}
                </p>
              </motion.div>
            )}
            {drafts.length > 1 && (
              <motion.ul
                key="many"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={FADE}
                className="max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-hairline p-2.5"
              >
                {drafts.map((draft, i) => (
                  <li key={`${draft.label}-${i}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{draft.label}</span>
                    <CategoryPill category={draft.category} />
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>

          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {chipOptions.map((c) => {
              const active = activeCategory === c;
              const auto = !pinnedCategory && active;
              return (
                <button
                  key={c}
                  // tapping the pinned chip again hands control back to auto
                  onClick={() => setPinnedCategory(pinnedCategory === c ? null : c)}
                  className={`pressable flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
                    active ? "btn-primary" : "border border-hairline text-fg-muted"
                  }`}
                >
                  {auto && "✨ "}
                  {categoryMeta(c).emoji} {c}
                </button>
              );
            })}
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
                onClick={() => {
                  setNewAssign(id);
                  setAssignPinned(true);
                }}
                className={`pressable flex-1 rounded-xl py-2.5 text-xs font-semibold disabled:opacity-40 ${
                  assignTo === id ? "btn-primary" : "border border-hairline text-fg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {!assignPinned && lead?.detectedAssignee && (
            <p className="-mt-2 text-[11px] text-fg-muted">
              Assigned from what you typed — the name is dropped from the label.
            </p>
          )}

          <button
            disabled={drafts.length === 0}
            onClick={commitDrafts}
            className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-40"
          >
            {drafts.length > 1 ? `Add ${drafts.length} items` : "Add to list"}
          </button>
        </div>
      </Sheet>

      {/* open is derived, so clearing the last proposal closes the sheet */}
      <Sheet
        open={tidyOpen && retags.length > 0}
        onClose={() => setTidyOpen(false)}
        title="Tidy up tags"
      >
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">
            These look filed under the wrong tag. Move them, or keep them where they are.
          </p>
          <ul className="space-y-1">
            <AnimatePresence initial={false} mode="popLayout">
              {retags.map((proposal) => (
                <motion.li
                  key={proposal.item.id}
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ ...FADE, layout: SPRING }}
                  className="flex items-center gap-2 rounded-xl px-1 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{proposal.item.label}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-muted">
                      <span className="line-through">{proposal.from}</span>
                      <span aria-hidden>→</span>
                      <CategoryPill category={proposal.to} />
                    </p>
                  </div>
                  <button
                    onClick={() => applyRetags([{ item: proposal.item, to: proposal.to }])}
                    className="btn-ghost pressable rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                  >
                    Move
                  </button>
                  <button
                    onClick={() => {
                      setTidySkipped((s) => [...s, proposal.item.id]);
                      if (retags.length === 1) setTidyOpen(false);
                    }}
                    aria-label={`Keep ${proposal.item.label} in ${proposal.from}`}
                    className="pressable rounded-lg px-2 py-1.5 text-fg-faint"
                  >
                    <IconX size={12} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <button
            onClick={() => applyRetags(retags.map((r) => ({ item: r.item, to: r.to })))}
            className="btn-primary pressable h-12 w-full rounded-xl font-semibold"
          >
            Move all {retags.length}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
