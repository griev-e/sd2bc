"use client";

import { useMemo, useState } from "react";
import AttributionDot from "@/components/Attribution";
import { IconCrown, IconX } from "@/components/Icons";
import { fmtMoney } from "@/lib/format";
import { useTrip } from "@/lib/store";
import { ScoreStrip, useGameEvents, usePlayers } from "./shared";

interface CarEntry {
  id: string;
  name: string;
  price: number;
  by: string | null;
  at: string;
}

/** Most-expensive-car-spotted leaderboard. Estimates are on your honor. */
export default function CarsGame() {
  const events = useGameEvents("cars");
  const { me, partner } = usePlayers();
  const addGameEvent = useTrip((s) => s.addGameEvent);
  const deleteGameEvent = useTrip((s) => s.deleteGameEvent);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  const cars = useMemo<CarEntry[]>(
    () =>
      events
        .filter((e) => e.kind === "entry")
        .map((e) => ({
          id: e.id,
          name: String(e.value.name ?? "?"),
          price: Number(e.value.price ?? 0),
          by: e.created_by,
          at: e.created_at,
        }))
        .sort((a, b) => b.price - a.price),
    [events],
  );

  const best = (by: string | undefined) =>
    cars.find((c) => c.by === by)?.price ?? 0;

  function submit() {
    const p = Math.round(Number(price.replace(/[^0-9.]/g, "")));
    if (!name.trim() || !p) return;
    void addGameEvent({
      game: "cars",
      kind: "entry",
      value: { name: name.trim(), price: p },
    });
    setName("");
    setPrice("");
  }

  return (
    <div className="space-y-3.5">
      <ScoreStrip
        me={me}
        partner={partner}
        mine={Math.round(best(me?.id) / 1000)}
        theirs={Math.round(best(partner?.id) / 1000)}
        unit="best · $k"
      />

      {/* log a sighting */}
      <section className="card space-y-2.5 p-4">
        <p className="eyebrow px-1">Spotted something fancy?</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lambo, G-Wagon, mystery hypercar…"
          className="field"
        />
        <div className="flex gap-2">
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="est. price $"
            inputMode="numeric"
            className="field flex-1"
          />
          <button
            onClick={submit}
            disabled={!name.trim() || !Number(price.replace(/[^0-9.]/g, ""))}
            className="btn-primary pressable rounded-xl px-5 text-sm font-semibold disabled:opacity-40"
          >
            Log it
          </button>
        </div>
      </section>

      {/* leaderboard */}
      {cars.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">
          No sightings yet — keep your eyes on the fast lane.
        </p>
      ) : (
        <section className="card p-4">
          <div className="space-y-1">
            {cars.map((car, i) => (
              <div
                key={car.id}
                className={`flex min-h-[48px] items-center gap-3 rounded-xl px-2 py-1.5 ${
                  i === 0 ? "bg-gold-soft" : ""
                }`}
              >
                {i === 0 ? (
                  <IconCrown size={16} className="flex-shrink-0 text-gold" />
                ) : (
                  <span className="mono w-4 flex-shrink-0 text-center text-[11px] text-fg-faint">
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{car.name}</p>
                  <p className="tnum text-[11px] text-fg-faint">
                    {new Date(car.at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <p className="tnum text-sm font-bold">{fmtMoney(car.price)}</p>
                <AttributionDot userId={car.by} size={16} />
                {car.by === me?.id && (
                  <button
                    onClick={() => void deleteGameEvent(car.id)}
                    aria-label="Remove entry"
                    className="pressable -mr-1 flex h-8 w-7 items-center justify-center text-fg-faint"
                  >
                    <IconX size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
