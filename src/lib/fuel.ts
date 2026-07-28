/*
  "When do we need gas?" — answered from data the app already has: each
  segment's real road miles, the trip's MPG, and the tank size.

  The west-coast loop is exactly the trip where this bites. Hwy 1 through Big
  Sur, the far Oregon coast and the stretches north of Vancouver Island go a
  long way between pumps, and the itinerary happily plans a 300-mile day that
  no tank can actually do in one go.

  A stop of kind "fuel" is a planned fill-up: passing one resets the count. So
  the warnings are also the fix — marking a stop as fuel makes one disappear.
*/

import { M_PER_MI } from "./budget";
import { bySeq, type Day, type DayRoute, type Stop } from "./types";

/** Tank assumed when the trip hasn't said. A mid-size crossover, roughly. */
export const DEFAULT_TANK_GAL = 14;

/**
 * Fraction of the tank we're willing to plan on using. Nobody drives to a dry
 * tank, the gauge lies near empty, and a headwind up the 101 is real — so the
 * usable range is the honest 85%, and warnings fire before the light comes on.
 */
export const FUEL_RESERVE = 0.85;

export interface FuelWarning {
  dayId: string;
  /** The stop we'd be arriving at on fumes. */
  toStopId: string;
  toStopName: string;
  /** Meters driven since the last fill-up by the time we get there. */
  sinceFuelM: number;
  /**
   * True when this single leg is longer than a whole tank — no amount of
   * timing helps, there has to be a stop in the middle.
   */
  legAlone: boolean;
}

export interface FuelPlan {
  tankGal: number;
  mpg: number;
  /** Meters we plan on getting out of one tank (after the reserve). */
  usableRangeM: number;
  warnings: FuelWarning[];
  /** Warnings grouped by day, for the itinerary cards. */
  byDay: Record<string, FuelWarning[]>;
}

export function usableRangeM(mpg: number, tankGal: number): number {
  return Math.max(0, mpg) * Math.max(0, tankGal) * FUEL_RESERVE * M_PER_MI;
}

/**
 * Walk the whole trip stop by stop, carrying the tank across day boundaries
 * (the drive doesn't care that you slept), and flag every point where we'd run
 * past the usable range before reaching a planned fill-up.
 *
 * After flagging one, the count resets: the traveler is going to buy gas
 * somewhere around there, and cascading the shortfall through the rest of the
 * trip would turn one real problem into fifteen fake ones.
 */
export function planFuel(
  orderedDays: Day[],
  stops: Stop[],
  routes: Record<string, DayRoute>,
  mpg: number,
  tankGal: number,
): FuelPlan {
  const rangeM = usableRangeM(mpg, tankGal);
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const warnings: FuelWarning[] = [];

  // Day one pulls out with a full tank; nothing before it to account for.
  let sinceM = 0;

  if (rangeM > 0) {
    for (const day of orderedDays) {
      for (const seg of routes[day.id]?.segments ?? []) {
        sinceM += seg.distanceM;
        const to = stopById.get(seg.toStopId);

        if (to?.kind === "fuel") {
          // A planned fill-up — but flag it anyway if we couldn't even coast in
          // on a full tank, because then the pump is out of reach too.
          if (seg.distanceM > rangeM) {
            warnings.push({
              dayId: day.id,
              toStopId: seg.toStopId,
              toStopName: to.name,
              sinceFuelM: seg.distanceM,
              legAlone: true,
            });
          }
          sinceM = 0;
          continue;
        }

        if (sinceM > rangeM) {
          warnings.push({
            dayId: day.id,
            toStopId: seg.toStopId,
            toStopName: to?.name ?? "the next stop",
            sinceFuelM: sinceM,
            legAlone: seg.distanceM > rangeM,
          });
          sinceM = 0;
        }
      }
    }
  }

  const byDay: Record<string, FuelWarning[]> = {};
  for (const w of warnings) (byDay[w.dayId] ??= []).push(w);

  return { tankGal, mpg, usableRangeM: rangeM, warnings, byDay };
}

/**
 * Meters between the day's first stop and its last planned fill-up — i.e. how
 * far into the tank the day gets you if you start it full. Used for the "you'll
 * want gas before tonight" line, independent of the hard warnings above.
 */
export function dayDriveM(day: Day, routes: Record<string, DayRoute>): number {
  return (routes[day.id]?.segments ?? []).reduce((sum, s) => sum + s.distanceM, 0);
}

/** Does this day have a fuel stop planned at all? */
export function dayHasFuelStop(day: Day, stops: Stop[]): boolean {
  return stops.some((s) => s.day_id === day.id && s.kind === "fuel");
}

/** The day's stops in drive order — shared shape with the rest of the app. */
export function fuelStopsOf(day: Day, stops: Stop[]): Stop[] {
  return stops.filter((s) => s.day_id === day.id && s.kind === "fuel").sort(bySeq);
}
