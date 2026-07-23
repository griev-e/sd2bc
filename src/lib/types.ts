export type StopKind =
  | "stop"
  | "scenic"
  | "food"
  | "fuel"
  | "activity"
  | "beach"
  | "lodging";

export type ExpenseCategory = "gas" | "lodging" | "food" | "activities";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  color: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Trip {
  id: string;
  name: string;
  start_date: string;
  mpg: number;
  travelers: number;
  /** Override for food $/person/day; null = use the regional seed default. */
  food_per_day: number | null;
  /** Override for activities $/person/day; null = use the seed default. */
  activities_per_day: number | null;
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
  /** Custom emoji for the day badge; null = a deterministic nature default. */
  emoji: string | null;
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
  /** Street address / place description; null = none recorded. */
  address: string | null;
  /** Booking / itinerary link for an overnight stay. */
  lodging_url: string | null;
  /** Free stay (e.g. staying with family) — counts $0 in the budget. */
  lodging_free: boolean;
  /** Known actual nightly cost; overrides the regional estimate. */
  lodging_cost: number | null;
  /** Scheduled local time "HH:MM" (24h), e.g. a departure or reservation. */
  start_time: string | null;
  /** Planned length of stay in minutes; null = just a point in time. */
  duration_min: number | null;
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

export type InsightCategory = "pacing" | "budget" | "route" | "weather";

/** One finding from the AI trip analyzer. */
export interface AnalysisInsight {
  /** Stable within its analysis row — dismissals key on this. */
  id: string;
  category: InsightCategory;
  severity: "info" | "warn";
  title: string;
  detail: string;
  /** Day the insight points at (Day.seq), or null for trip-wide findings. */
  day_seq: number | null;
  /**
   * For route-order findings: the day's stops (by exact name) in the order
   * the model recommends — powers the one-tap "apply this order" action.
   * Absent on rows cached before this field existed.
   */
  suggested_order?: string[] | null;
}

/** Cached AI analysis of one exact trip state (keyed by analysisKey()). */
export interface TripAnalysis {
  id: string;
  trip_id: string;
  key: string;
  model: string;
  insights: AnalysisInsight[];
  /** Insight ids either traveler dismissed — shared, last-write-wins. */
  dismissed: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type GameId = "plates" | "cars" | "roadside" | "words" | "fastfood" | "wordle";
export type GameEventKind = "claim" | "entry" | "count" | "score";

/** One row in the shared road-games event stream. */
export interface GameEvent {
  id: string;
  game: GameId;
  kind: GameEventKind;
  key: string | null;
  value: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}
