"use client";

import { useState } from "react";
import CountdownPill from "@/components/CountdownPill";
import CarsGame from "@/components/games/CarsGame";
import FastFoodGame from "@/components/games/FastFoodGame";
import PlatesGame from "@/components/games/PlatesGame";
import RoadsideGame from "@/components/games/RoadsideGame";
import WordRushGame from "@/components/games/WordRushGame";
import type { GameId } from "@/lib/types";

const GAMES: { id: GameId; label: string; blurb: string }[] = [
  { id: "plates", label: "Plates", blurb: "License-plate bingo, first tap wins" },
  { id: "roadside", label: "I spy", blurb: "Roadside scavenger hunt" },
  { id: "fastfood", label: "Chains", blurb: "Count your chain's sightings" },
  { id: "cars", label: "Fancy cars", blurb: "Priciest spot on record" },
  { id: "words", label: "Word rush", blurb: "Taboo, 60 seconds a round" },
];

export default function GamesPage() {
  const [active, setActive] = useState<GameId>("plates");
  const game = GAMES.find((g) => g.id === active)!;

  return (
    <div className="min-h-dvh pb-32">
      <header className="pt-safe sticky top-0 z-30">
        <div className="glass border-x-0 border-t-0 px-5 pb-3.5 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Backseat Olympics</p>
              <h1 className="display mt-0.5 text-[22px] tracking-tight">Games</h1>
            </div>
            <CountdownPill />
          </div>
          <div className="no-scrollbar -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
            {GAMES.map((g) => (
              <button
                key={g.id}
                onClick={() => setActive(g.id)}
                className={`pressable flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold ${
                  active === g.id ? "btn-primary" : "border border-hairline text-fg-muted"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="px-4 pt-4">
        <p className="mb-3 px-1 text-[11px] text-fg-faint">{game.blurb} — synced live to both phones.</p>
        {active === "plates" && <PlatesGame />}
        {active === "roadside" && <RoadsideGame />}
        {active === "fastfood" && <FastFoodGame />}
        {active === "cars" && <CarsGame />}
        {active === "words" && <WordRushGame />}
      </div>
    </div>
  );
}
