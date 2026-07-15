"use client";

import { create } from "zustand";
import type { Suggestion } from "./overpass";

/**
 * Transient bridge between the suggest sheet and the map: while the sheet is
 * showing results, the same places appear as pins on the map so you can see
 * *where* a suggestion is before adding it. Cleared when the sheet closes.
 */
interface SuggestionPreviewState {
  pins: Suggestion[];
  setPins: (pins: Suggestion[]) => void;
}

export const useSuggestionPreview = create<SuggestionPreviewState>((set) => ({
  pins: [],
  setPins: (pins) => set({ pins }),
}));
