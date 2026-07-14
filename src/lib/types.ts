export type StopKind =
  | "stop"
  | "scenic"
  | "food"
  | "fuel"
  | "activity"
  | "beach"
  | "lodging";

export type ExpenseCategory = "gas" | "lodging" | "food" | "activities" | "misc";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  color: string;
  created_at: string;
}

export interface Trip {
  id: string;
  name: string;
  start_date: string;
  mpg: number;
  travelers: number;
  created_at: string;
  updated_at: string;
}

export interface Day {
  id: string;
  trip_id: string;
  seq: number;
  date: string;
  title: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Stop {
  id: string;
  trip_id: string;
  day_id: string;
  seq: number;
  name: string;
  lat: number;
  lng: number;
  kind: StopKind;
  is_overnight: boolean;
  notes: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ViaPoint {
  id: string;
  trip_id: string;
  after_stop_id: string;
  seq: number;
  lat: number;
  lng: number;
  created_by: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  trip_id: string;
  category: ExpenseCategory;
  amount: number;
  note: string;
  spent_on: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackingItem {
  id: string;
  trip_id: string;
  category: string;
  label: string;
  checked: boolean;
  checked_by: string | null;
  assigned_to: string | null; // null = shared
  seq: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityEntry {
  id: number;
  trip_id: string | null;
  actor: string | null;
  entity: string;
  action: string;
  summary: string;
  created_at: string;
}

/** One drivable segment between two real stops (via points folded in). */
export interface RouteSegment {
  fromStopId: string;
  toStopId: string;
  distanceM: number;
  durationS: number;
}

/** Computed route for one day (starts at previous day's overnight stop). */
export interface DayRoute {
  dayId: string;
  /** GeoJSON LineString coordinates [lng, lat][] */
  coordinates: [number, number][];
  segments: RouteSegment[];
  distanceM: number;
  durationS: number;
}
