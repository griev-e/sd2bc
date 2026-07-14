"use client";

import { useMemo, useState } from "react";
import AttributionDot from "@/components/Attribution";
import CountdownPill from "@/components/CountdownPill";
import { IconPlus, IconX } from "@/components/Icons";
import Sheet from "@/components/Sheet";
import { useTrip } from "@/lib/store";

type AssignFilter = "all" | "me" | "partner" | "shared";

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

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Packing</p>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight">The kit</h1>
            </div>
            <CountdownPill />
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/5">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${packing.length ? (done / packing.length) * 100 : 0}%`,
                  background: "var(--accent-gradient)",
                }}
              />
            </div>
            <span className="tnum text-xs font-semibold text-fg-muted">
              {done}/{packing.length}
            </span>
          </div>
        </div>
      </header>

      <div className="px-4 pt-3">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-3">
          {(
            [
              ["all", "Everything"],
              ["me", "Mine"],
              ["partner", partner ? partner.username : "Theirs"],
              ["shared", "Shared"],
            ] as [AssignFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`pressable flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
                filter === key ? "btn-primary" : "glass text-fg-muted"
              }`}
            >
              {label}
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
          {groups.map(([category, items]) => (
            <section key={category} className="card p-4">
              <p className="eyebrow mb-2 px-1">{category}</p>
              <div>
                {items.map((item) => (
                  <label
                    key={item.id}
                    className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl px-1.5 py-1 active:bg-fg/5"
                  >
                    <input
                      type="checkbox"
                      className="check-pill"
                      checked={item.checked}
                      onChange={(e) => void togglePacking(item.id, e.target.checked)}
                    />
                    <span
                      className={`flex-1 text-sm ${
                        item.checked ? "text-fg-faint line-through" : "font-medium"
                      }`}
                    >
                      {item.label}
                    </span>
                    {item.assigned_to && (
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                        {profiles.find((p) => p.id === item.assigned_to)?.username ?? "?"}
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
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add item"
        className="btn-primary pressable fixed bottom-[calc(env(safe-area-inset-bottom)+84px)] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl"
      >
        <IconPlus size={20} />
      </button>

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
                [partner?.id ?? "none", partner?.username ?? "Partner"],
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
