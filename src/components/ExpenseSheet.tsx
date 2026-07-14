"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { ExpenseCategoryIcon } from "./CategoryIcon";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/costs";
import { localDateISO } from "@/lib/format";
import { useTrip } from "@/lib/store";
import type { ExpenseCategory } from "@/lib/types";

export default function ExpenseSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addExpense = useTrip((s) => s.addExpense);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(localDateISO());

  const value = parseFloat(amount);
  const valid = !isNaN(value) && value > 0;

  function reset() {
    setAmount("");
    setNote("");
    setDate(localDateISO());
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log an expense">
      <div className="space-y-4">
        <div className="flex items-baseline justify-center gap-1 py-2">
          <span className="text-2xl font-semibold text-fg-muted">$</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            inputMode="decimal"
            autoFocus
            className="tnum w-44 bg-transparent text-center text-5xl font-bold tracking-tight outline-none placeholder:text-fg-faint"
          />
        </div>

        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`pressable flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2.5 text-xs font-semibold ${
                category === c ? "btn-primary" : "border border-hairline text-fg-muted"
              }`}
            >
              <ExpenseCategoryIcon category={c} size={13} strokeWidth={2} />
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="field min-w-0 flex-1"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field w-auto px-2.5 text-sm"
          />
        </div>

        <button
          disabled={!valid}
          onClick={() => {
            void addExpense({ category, amount: value, note: note.trim(), spent_on: date });
            reset();
            onClose();
          }}
          className="btn-primary pressable h-12 w-full rounded-xl font-semibold disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
