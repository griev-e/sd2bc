"use client";

import maplibregl, {
  Map as MLMap,
  Marker,
  type ExpressionSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT, MAP_STYLE_SATELLITE } from "@/lib/config";
import { IconLayers } from "./Icons";
import { clusterKey, clusterStops } from "@/lib/clusters";
import { dayColor } from "@/lib/colors";
import { fmtMiles } from "@/lib/format";
import { bboxOf, circleRing, type LngLat } from "@/lib/geo";
import {
  buildJourney,
  getVehiclePref,
  liveDistance,
  nearestOnJourney,
  positionAtDistance,
  serverVehiclePref,
  vehicleEmoji,
  vehicleSubscribe,
} from "@/lib/journey";
import { useLocation, type LocationFix, type LocationStatus } from "@/lib/location";
import { FADE, riseIn } from "@/lib/motion";
import { SUGGESTION_CATEGORIES } from "@/lib/overpass";
import { useSchedule } from "@/lib/schedule";
import { insertShapingPoint } from "@/lib/shaping";
import { stopsForDay, useOrderedDays, useTrip } from "@/lib/store";
import { useSuggestionPreview } from "@/lib/suggestionPreview";
import { effectiveDark } from "@/lib/theme";
import { useWeather, WEATHER_EMOJI, weatherKind } from "@/lib/weather";
import type { Stop } from "@/lib/types";

interface MapViewProps {
  onSelectStop: (stop: Stop) => void;
  onLongPress?: (lngLat: LngLat) => void;
}

type StyleMode = "street" | "satellite";

const STYLE_PREF_KEY = "coastline-map-style";
const SHOW_VIAS_KEY = "coastline-show-vias";

/** What to say when the blip can't be shown. Silence would read as a bug. */
const LOCATION_NOTICE: Partial<Record<LocationStatus, string>> = {
  denied: "Location is blocked — turn it back on for this site in your browser settings.",
  unavailable: "This browser can't share a location.",
  error: "Couldn't get a fix — try again with a clearer view of the sky.",
};

/** Beyond this far off the line, a fix says nothing about where on the route we are. */
const OFF_ROUTE_LIMIT_M = 60_000;
/** Within this of the plan (measured along the route), we call it on schedule. */
const ON_PACE_M = 800;
/** Device-local: whether the "where we should be" marker is shown. */
const SHOW_PLAN_KEY = "coastline-show-plan";

const CATEGORY_ICON = Object.fromEntries(
  SUGGESTION_CATEGORIES.map((c) => [c.key, c.icon]),
) as Record<string, string>;

/**
 * GPS accuracy halo — a real-world-sized ring under the blip, so the circle
 * keeps meaning the same thing at every zoom. Added alongside the route layers
 * and rebuilt after a style swap, same as they are.
 */
function addLocationLayers(map: MLMap) {
  if (map.getSource("location")) return;
  map.addSource("location", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "location-accuracy-fill",
    type: "fill",
    source: "location",
    paint: { "fill-color": "#0d9488", "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "location-accuracy-line",
    type: "line",
    source: "location",
    paint: { "line-color": "#0d9488", "line-width": 1, "line-opacity": 0.35 },
  });
}

/** Route source + line layers — added on style load and after every setStyle. */
function addRouteLayers(map: MLMap, mode: StyleMode, dark: boolean) {
  if (map.getSource("routes")) return;
  map.addSource("routes", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      // raw hex, not tokens — MapLibre paints on canvas and can't read CSS
      // vars; values mirror --bg-elevated / near-black from globals.css
      "line-color": mode === "satellite" ? "#ffffff" : dark ? "#0a0f13" : "#ffffff",
      "line-width": 7,
      "line-opacity": ["get", "opacity"],
    },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4,
      "line-opacity": ["get", "opacity"],
    },
  });
}

/* ---- persistent map singleton --------------------------------------------
   Rebuilding a MapLibre map costs a style fetch, glyph/tile fetches and a
   fresh WebGL context — seconds on a phone, on every visit to the map tab.
   Worse, on flaky cell data a single failed style fetch used to leave the tab
   permanently blank (`load` never fires, nothing retries) until the next
   remount. So the map is created once, DETACHED — never destroyed — when the
   tab unmounts, and re-attached instantly on return, with camera, style,
   tiles and markers intact.

   Everything hanging off the map instance persists beside it (marker
   registries, the plan/blip markers); the component's diffing effects refresh
   positions and handlers on every mount. Map-level event handlers are bound
   once and dispatch through `hooks`, which the live component instance fills
   in on mount — a bound-once listener must never close over a dead render. */

interface HostHooks {
  longPress?: (lngLat: LngLat) => void;
  routeTap?: (dayId: string, lngLat: LngLat) => void;
  /** A style finished loading (first load, theme/mode swap, or a retry). */
  styleReady?: () => void;
}

type StyleKey = "street-light" | "street-dark" | "satellite";

let sharedMap: MLMap | null = null;
const hooks: HostHooks = {};
/** The style the map should currently be wearing (retries re-request this). */
let desiredKey: StyleKey = "street-light";
let styleRetryTimer: ReturnType<typeof setTimeout> | null = null;
let styleRetryDelay = 2_000;
let didInitialFit = false;

const persistentStopMarkers = new Map<string, { marker: Marker; dayId: string }>();
const persistentViaMarkers = new Map<string, Marker>();
const persistentWeatherMarkers = new Map<string, { marker: Marker; dayId: string }>();
const suggestionMarkers: { current: Marker[] } = { current: [] };
const journeyMarker: { current: Marker | null } = { current: null };
const blipMarker: { current: Marker | null } = { current: null };

function desiredStyleKey(): StyleKey {
  if (localStorage.getItem(STYLE_PREF_KEY) === "satellite") return "satellite";
  return effectiveDark() ? "street-dark" : "street-light";
}

function styleFor(key: StyleKey): string | StyleSpecification {
  if (key === "satellite") return MAP_STYLE_SATELLITE as StyleSpecification;
  return key === "street-dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
}

/**
 * Dead-zone resilience: when a style fetch fails the map sits blank and no
 * event ever fires again — re-request it on a capped backoff, and instantly
 * when the network comes back. A successful `style.load` clears all of this.
 */
function scheduleStyleRetry(map: MLMap) {
  if (styleRetryTimer) return;
  styleRetryTimer = setTimeout(() => {
    styleRetryTimer = null;
    if (map.isStyleLoaded()) return;
    styleRetryDelay = Math.min(styleRetryDelay * 2, 30_000);
    map.setStyle(styleFor(desiredKey));
  }, styleRetryDelay);
}

function ensureSharedMap(): MLMap {
  if (sharedMap) return sharedMap;

  // The map owns its own element, appended into whichever host is mounted.
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.inset = "0";

  desiredKey = desiredStyleKey();
  const map = new maplibregl.Map({
    container: el,
    style: styleFor(desiredKey),
    center: [-122.6, 40.5],
    zoom: 4.6,
    attributionControl: { compact: true },
  });
  sharedMap = map;

  // test hook (harmless in production)
  (window as unknown as { __coastlineMap?: MLMap }).__coastlineMap = map;

  // One place rebuilds the layers after EVERY style arrival — initial load,
  // street⇄satellite, theme reconcile, and failure retries alike.
  map.on("style.load", () => {
    styleRetryDelay = 2_000;
    if (styleRetryTimer) {
      clearTimeout(styleRetryTimer);
      styleRetryTimer = null;
    }
    addRouteLayers(
      map,
      desiredKey === "satellite" ? "satellite" : "street",
      desiredKey === "street-dark",
    );
    addLocationLayers(map);
    hooks.styleReady?.();
  });

  map.on("error", (e) => {
    // Tile/glyph noise once the style is in is not ours to handle; a failure
    // while the style is missing means a blank map — that one we retry.
    if (!map.isStyleLoaded()) scheduleStyleRetry(map);
    else if (e?.error) console.warn("map error:", e.error);
  });
  window.addEventListener("online", () => {
    if (sharedMap && !sharedMap.isStyleLoaded()) {
      if (styleRetryTimer) clearTimeout(styleRetryTimer);
      styleRetryTimer = null;
      sharedMap.setStyle(styleFor(desiredKey));
    }
  });

  // Tap the line → drop a shaping point in that gap. Delegated by layer id,
  // so these survive every style swap.
  map.on("click", "route-line", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    hooks.routeTap?.(feature.properties?.dayId as string, [e.lngLat.lng, e.lngLat.lat]);
    e.preventDefault();
  });
  map.on("mouseenter", "route-line", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "route-line", () => (map.getCanvas().style.cursor = ""));

  // Long-press → add a real stop here.
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressStart: { x: number; y: number } | null = null;
  const cancel = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  };
  map.on("touchstart", (e) => {
    if (e.points.length !== 1) {
      cancel(); // a second finger means pinch/rotate, not a long-press
      return;
    }
    pressStart = { x: e.point.x, y: e.point.y };
    const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
    pressTimer = setTimeout(() => hooks.longPress?.(lngLat), 550);
  });
  map.on("touchmove", (e) => {
    if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 12)
      cancel();
  });
  map.on("touchend", cancel);
  // touchcancel (not touchend) fires when iOS steals the touch for a system
  // gesture — without this the timer still fires a phantom long-press
  map.on("touchcancel", cancel);
  map.on("dragstart", cancel);

  return map;
}

export default function MapView({ onSelectStop, onLongPress }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const stopMarkers = useRef(persistentStopMarkers);
  const viaMarkers = useRef(persistentViaMarkers);
  const weatherMarkers = useRef(persistentWeatherMarkers);
  // Ready from the very first render when the persistent map is already
  // dressed (back from another tab, same theme) — the common case after the
  // first visit, and the reason returning to the map is instant.
  const [mapReady, setMapReady] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      sharedMap !== null &&
      desiredStyleKey() === desiredKey &&
      sharedMap.isStyleLoaded() === true && // typed boolean | void upstream
      sharedMap.getSource("routes") !== undefined,
  );
  const [selectedVia, setSelectedVia] = useState<string | null>(null);
  const [styleMode, setStyleMode] = useState<StyleMode>(() =>
    typeof window !== "undefined" && localStorage.getItem(STYLE_PREF_KEY) === "satellite"
      ? "satellite"
      : "street",
  );
  // bumped after every style swap so data-dependent effects re-apply
  const [styleEpoch, setStyleEpoch] = useState(0);
  // shaping points stay hidden until asked for (or one is being placed)
  const [showVias, setShowVias] = useState<boolean>(
    () => typeof window !== "undefined" && localStorage.getItem(SHOW_VIAS_KEY) === "1",
  );

  function setShowViasPref(v: boolean) {
    setShowVias(v);
    if (!v) setSelectedVia(null); // no hidden marker should keep its delete pill
    localStorage.setItem(SHOW_VIAS_KEY, v ? "1" : "0");
  }

  // Stable identities for callbacks used inside the one-shot map init effect.
  const fireLongPress = useEffectEvent((lngLat: LngLat) => onLongPress?.(lngLat));
  const fireSelectStop = useEffectEvent((stop: Stop) => onSelectStop(stop));
  // placing a shaping point reveals the handles so it can be dragged
  const fireRouteTap = useEffectEvent((dayId: string, lngLat: LngLat) => {
    void insertShapingPoint(dayId, lngLat);
    setShowViasPref(true);
  });

  const stops = useTrip((s) => s.stops);
  const viaPoints = useTrip((s) => s.viaPoints);
  const routes = useTrip((s) => s.routes);
  const selectedDayId = useTrip((s) => s.selectedDayId);
  const selectedStopId = useTrip((s) => s.selectedStopId);
  const moveViaPoint = useTrip((s) => s.moveViaPoint);
  const deleteViaPoint = useTrip((s) => s.deleteViaPoint);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);
  const byCluster = useWeather((s) => s.byCluster);

  const orderedDays = useOrderedDays();

  // ---- journey vehicle (the "should be here" marker) -----------------------
  // "Where are we" is answered by the live GPS blip below; this emoji is the
  // schedule's answer to "where are we *supposed* to be right now" — the day
  // routes stitched into one timeline, positioned by the clock. Shown or
  // hidden with the map's plan toggle, remembered per device like the vias.
  const schedule = useSchedule();
  const vehicleKey = useSyncExternalStore(vehicleSubscribe, getVehiclePref, serverVehiclePref);
  const journey = useMemo(() => buildJourney(orderedDays, routes), [orderedDays, routes]);
  // refs so the imperative positioner always reads the latest values without
  // being torn down and rebuilt for a mere emoji swap or route recompute
  const journeyRef = useRef(journey);
  const emojiRef = useRef(vehicleEmoji(vehicleKey));
  const [showPlan, setShowPlan] = useState<boolean>(
    () => typeof window !== "undefined" && localStorage.getItem(SHOW_PLAN_KEY) === "1",
  );
  /** The planned distance (and how far the live fix sits from it) for the HUD. */
  const [plan, setPlan] = useState<{ dist: number; deltaM: number | null } | null>(null);
  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  // ---- live location ------------------------------------------------------
  const locStatus = useLocation((s) => s.status);
  /** The status whose notice has already had its say. */
  const [noticeSeen, setNoticeSeen] = useState<LocationStatus | null>(null);

  // ---- attach the persistent map -------------------------------------------
  // The map instance outlives this component (see the singleton block above):
  // mounting means adopting it — append its element, point the hooks at this
  // instance, reconcile the style with whatever theme/mode changed while the
  // tab was away, and declare readiness if the style is already in.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const map = ensureSharedMap();
    mapRef.current = map;
    host.appendChild(map.getContainer());
    map.resize();

    hooks.longPress = (lngLat) => fireLongPress(lngLat);
    hooks.routeTap = (dayId, lngLat) => fireRouteTap(dayId, lngLat);
    hooks.styleReady = () => {
      setMapReady(true);
      setStyleEpoch((e) => e + 1); // data-dependent effects re-apply
    };

    // Theme/mode may have changed while the map was away — swap and wait for
    // styleReady. Otherwise mapReady's initializer already said yes, or the
    // first load / its dead-zone retry is in flight and styleReady will fire.
    const wanted = desiredStyleKey();
    if (wanted !== desiredKey) {
      desiredKey = wanted;
      map.setStyle(styleFor(wanted));
    }

    return () => {
      hooks.longPress = undefined;
      hooks.routeTap = undefined;
      hooks.styleReady = undefined;
      map.getContainer().remove(); // detach, never destroy
      mapRef.current = null;
    };

  }, []);


  // ---- route layers ---------------------------------------------------------
  // While the draw-on sweep (below) animates a day, that day's static feature
  // is held invisible — the overlay IS the line until the sweep finishes.
  const drawAnim = useRef<{ dayId: string; raf: number } | null>(null);

  // Effect event so the draw-on animation can re-sync with the *latest*
  // routes/selection at any point (its rAF loop outlives the effect closure).
  const syncRouteData = useEffectEvent(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features = orderedDays
      .map((d, i) => {
        const route = routes[d.id];
        if (!route || route.coordinates.length < 2) return null;
        const dim = selectedDayId !== null && selectedDayId !== d.id;
        const drawing = drawAnim.current?.dayId === d.id;
        return {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: route.coordinates },
          properties: {
            dayId: d.id,
            color: dayColor(i, orderedDays.length),
            opacity: drawing ? 0 : dim ? 0.18 : 0.95,
          },
        };
      })
      .filter(Boolean);
    source.setData({
      type: "FeatureCollection",
      features: features as GeoJSON.Feature[],
    });
  });

  useEffect(() => {
    if (!mapReady) return;
    syncRouteData();
  }, [routes, selectedDayId, mapReady, orderedDays, styleEpoch]);

  // ---- street ⇄ satellite ---------------------------------------------------
  // setStyle wipes sources/layers; the singleton's persistent style.load
  // handler rebuilds them (with the palette from desiredKey) and pings
  // styleReady, which bumps styleEpoch so the data effects re-apply.
  const toggleStyle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next: StyleMode = styleMode === "street" ? "satellite" : "street";
    setStyleMode(next);
    localStorage.setItem(STYLE_PREF_KEY, next);
    desiredKey =
      next === "satellite" ? "satellite" : effectiveDark() ? "street-dark" : "street-light";
    map.setStyle(styleFor(desiredKey));
  }, [styleMode]);

  // ---- selected-day draw-on -------------------------------------------------
  // Selecting a day sweeps its route in from origin to destination (~700ms):
  // a temporary lineMetrics source + two gradient-trimmed layers (casing +
  // color, mirroring the static pair) animate on top while syncRouteData
  // holds the static feature invisible, then everything swaps back in one
  // frame. The gradient is a hard step at the draw front — interpolating to
  // transparent would mix through darkened color.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const removeOverlay = () => {
      if (map.getLayer("route-draw-line")) map.removeLayer("route-draw-line");
      if (map.getLayer("route-draw-casing")) map.removeLayer("route-draw-casing");
      if (map.getSource("route-draw")) map.removeSource("route-draw");
    };

    if (!selectedDayId) return;
    const dayIndex = orderedDays.findIndex((d) => d.id === selectedDayId);
    const route = routes[selectedDayId];
    if (dayIndex === -1 || !route || route.coordinates.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const color = dayColor(dayIndex, orderedDays.length);
    const dark = effectiveDark();
    const casing = styleMode === "satellite" ? "#ffffff" : dark ? "#0a0f13" : "#ffffff";
    // progress < p → colored, beyond → transparent; p > 1 = fully drawn
    const trim = (c: string, p: number): ExpressionSpecification => [
      "step",
      ["line-progress"],
      c,
      Math.max(p, Number.MIN_VALUE), // step stops must be > the previous one
      "rgba(0, 0, 0, 0)",
    ];

    map.addSource("route-draw", {
      type: "geojson",
      lineMetrics: true, // line-progress needs this
      data: {
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.coordinates },
        properties: {},
      },
    });
    map.addLayer({
      id: "route-draw-casing",
      type: "line",
      source: "route-draw",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": 7, "line-opacity": 0.95, "line-gradient": trim(casing, 0) },
    });
    map.addLayer({
      id: "route-draw-line",
      type: "line",
      source: "route-draw",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": 4, "line-opacity": 0.95, "line-gradient": trim(color, 0) },
    });

    drawAnim.current = { dayId: selectedDayId, raf: 0 };
    syncRouteData(); // hide the static feature under the overlay

    const DURATION = 700;
    const t0 = performance.now();
    const tick = (now: number) => {
      // a style swap wipes the overlay mid-flight — stop and restore
      if (!map.getLayer("route-draw-line")) {
        drawAnim.current = null;
        syncRouteData();
        return;
      }
      const t = Math.min(1, (now - t0) / DURATION);
      const p = 1 - Math.pow(1 - t, 3); // easeOutCubic
      map.setPaintProperty("route-draw-line", "line-gradient", trim(color, p * 1.001));
      map.setPaintProperty("route-draw-casing", "line-gradient", trim(casing, p * 1.001));
      if (t < 1) {
        drawAnim.current = { dayId: selectedDayId, raf: requestAnimationFrame(tick) };
      } else {
        // swap back in one task → the map repaints once, no double-draw
        drawAnim.current = null;
        syncRouteData();
        removeOverlay();
      }
    };
    drawAnim.current.raf = requestAnimationFrame(tick);

    return () => {
      // the map outlives this component now — the sweep overlay must not
      if (drawAnim.current) {
        cancelAnimationFrame(drawAnim.current.raf);
        drawAnim.current = null;
      }
      if (map.getStyle()) removeOverlay(); // no style mid-swap = nothing to remove
    };
    // routes/orderedDays deliberately absent — a route recompute or day edit
    // must not replay the sweep; the sync effect above keeps the data fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayId, mapReady, styleEpoch, styleMode]);

  // ---- stop markers (diffed in place — an edit to one stop must not tear
  // down and recreate every marker element on the map) ------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const seen = new Set<string>();
    orderedDays.forEach((day, i) => {
      const color = dayColor(i, orderedDays.length);
      stopsForDay(stops, day.id).forEach((stop, si) => {
        seen.add(stop.id);
        let entry = stopMarkers.current.get(stop.id);
        if (!entry) {
          const el = document.createElement("div");
          // cascade the pop-in (globals.css `marker-pop`) in stop order — set
          // once at creation so later diff runs never replay the delay
          el.style.animationDelay = `${Math.min(si, 12) * 30}ms`;
          entry = {
            marker: new maplibregl.Marker({ element: el })
              .setLngLat([stop.lng, stop.lat])
              .addTo(map),
            dayId: day.id,
          };
          stopMarkers.current.set(stop.id, entry);
        } else {
          entry.marker.setLngLat([stop.lng, stop.lat]);
          entry.dayId = day.id;
        }
        const el = entry.marker.getElement();
        // preserve the selection highlight — a separate effect owns it
        const selected = el.classList.contains("selected");
        el.className = `stop-marker${stop.is_overnight ? " overnight" : ""}${selected ? " selected" : ""}`;
        el.style.background = color;
        el.textContent = String(si + 1);
        // onclick (not addEventListener) so re-renders replace, never stack
        el.onclick = (ev) => {
          ev.stopPropagation();
          setSelectedStop(stop.id);
          fireSelectStop(stop);
        };
      });
    });

    for (const [id, entry] of stopMarkers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        stopMarkers.current.delete(id);
      }
    }
  }, [stops, orderedDays, mapReady, setSelectedStop]);

  // highlight the selected stop without rebuilding markers
  useEffect(() => {
    for (const [id, { marker }] of stopMarkers.current) {
      marker.getElement().classList.toggle("selected", id === selectedStopId);
    }
  }, [selectedStopId, stops]);

  // ---- weather badges (one per stop cluster, diffed like the stop markers) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const seen = new Set<string>();
    for (const day of orderedDays) {
      const dayStops = stopsForDay(stops, day.id);
      for (const c of clusterStops(dayStops)) {
        const w = byCluster[clusterKey(day.id, c.repStopId)];
        if (!w) continue;

        seen.add(c.repStopId);
        let entry = weatherMarkers.current.get(c.repStopId);
        if (!entry) {
          const el = document.createElement("div");
          el.className = "weather-badge";
          // float above the stop dot; never intercept the stop's tap
          entry = {
            marker: new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -16] })
              .setLngLat([c.lng, c.lat])
              .addTo(map),
            dayId: day.id,
          };
          weatherMarkers.current.set(c.repStopId, entry);
        } else {
          entry.marker.setLngLat([c.lng, c.lat]);
          entry.dayId = day.id;
        }
        entry.marker.getElement().textContent = `${WEATHER_EMOJI[weatherKind(w.code)]} ${w.tempF}°`;
      }
    }

    for (const [id, entry] of weatherMarkers.current) {
      if (!seen.has(id)) {
        entry.marker.remove();
        weatherMarkers.current.delete(id);
      }
    }
  }, [stops, orderedDays, mapReady, byCluster]);

  // Dim markers off the selected day in place — selecting a day no longer
  // tears down and recreates every marker element.
  useEffect(() => {
    const dimFor = (dayId: string) =>
      selectedDayId !== null && selectedDayId !== dayId ? "0.35" : "1";
    for (const [, { marker, dayId }] of stopMarkers.current) {
      marker.getElement().style.opacity = dimFor(dayId);
    }
    for (const [, { marker, dayId }] of weatherMarkers.current) {
      marker.getElement().style.opacity = dimFor(dayId);
    }
  }, [selectedDayId, stops, orderedDays, byCluster, mapReady]);

  // ---- suggestion preview pins (while the suggest sheet shows results) --------
  const suggestionPins = useSuggestionPreview((s) => s.pins);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // the set changes wholesale per category fetch — rebuild is the diff
    for (const m of suggestionMarkers.current) m.remove();
    suggestionMarkers.current = [];

    for (const s of suggestionPins) {
      const el = document.createElement("div");
      el.className = "suggestion-pin";
      el.textContent = CATEGORY_ICON[s.category] ?? "📍";
      el.title = s.name;
      suggestionMarkers.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([s.lng, s.lat])
          .addTo(map),
      );
    }
  }, [suggestionPins, mapReady]);

  // ---- via (shaping) markers ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const [, m] of viaMarkers.current) m.remove();
    viaMarkers.current.clear();
    if (!showVias) return;

    for (const via of viaPoints) {
      const el = document.createElement("div");
      el.className = "via-marker";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSelectedVia((cur) => (cur === via.id ? null : via.id));
      });
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([via.lng, via.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        void moveViaPoint(via.id, pos.lng, pos.lat);
      });
      viaMarkers.current.set(via.id, marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viaPoints, mapReady, showVias]);

  // ---- journey vehicle marker ---------------------------------------------------
  // Positioned imperatively (direct setLngLat, no per-move React state for the
  // marker itself) — the same discipline the live blip uses below.
  const positionMarker = useCallback((dist: number) => {
    const map = mapRef.current;
    if (!map) return;
    const j = journeyRef.current;
    const pos = j.points.length > 0 ? positionAtDistance(j, dist) : null;
    if (!pos) {
      if (journeyMarker.current) {
        journeyMarker.current.remove();
        journeyMarker.current = null;
      }
      return;
    }
    if (!journeyMarker.current) {
      const el = document.createElement("div");
      el.className = "journey-marker";
      el.textContent = emojiRef.current;
      journeyMarker.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(pos.lngLat)
        .addTo(map);
    } else {
      journeyMarker.current.setLngLat(pos.lngLat);
    }
    journeyMarker.current.getElement().textContent = emojiRef.current;
  }, []);

  // the toggle owns the vehicle marker outright — clear it the moment it hides
  useEffect(() => {
    if (showPlan) return;
    journeyMarker.current?.remove();
    journeyMarker.current = null;
  }, [showPlan]);

  // swap the emoji in place the instant the pick changes (no reposition)
  useEffect(() => {
    emojiRef.current = vehicleEmoji(vehicleKey);
    const el = journeyMarker.current?.getElement();
    if (el) el.textContent = emojiRef.current;
  }, [vehicleKey]);

  // While shown, the marker sits where the clock says we should be and is
  // re-placed on a slow tick — a minute of a driving day is only a mile or
  // two, so 30s keeps it honest without burning frames — and immediately
  // whenever the routes, stops, or schedule shift underneath it.
  useEffect(() => {
    if (!showPlan || !mapReady) return;
    const sync = () => {
      if (journey.totalDist <= 0) {
        setPlan(null);
        return;
      }
      const dist = liveDistance(journey, orderedDays, stops, schedule, new Date());
      positionMarker(dist);
      // Pacing vs the plan is measured *along the route* (a curvy coastal mile
      // counts as a mile). A fix wildly off the line says nothing about our
      // progress, so it reports no delta rather than a misleading one.
      let deltaM: number | null = null;
      const fix = useLocation.getState().fix;
      if (fix) {
        const near = nearestOnJourney(journey, fix.lngLat);
        if (near && near.offRouteM <= OFF_ROUTE_LIMIT_M) deltaM = near.dist - dist;
      }
      setPlan({ dist, deltaM });
    };
    sync();
    const tick = setInterval(sync, 30_000);
    return () => clearInterval(tick);
  }, [showPlan, mapReady, journey, orderedDays, stops, schedule, positionMarker]);

  /**
   * Turning the plan on brings the marker on screen (it may be a state away
   * from wherever the map is parked); turning it off just hides it.
   */
  function togglePlan() {
    const next = !showPlan;
    setShowPlan(next);
    localStorage.setItem(SHOW_PLAN_KEY, next ? "1" : "0");
    if (!next) {
      setPlan(null); // don't flash last time's HUD on the next show
      return;
    }
    const map = mapRef.current;
    if (!map || journey.totalDist <= 0) return;
    const pos = positionAtDistance(
      journey,
      liveDistance(journey, orderedDays, stops, schedule, new Date()),
    );
    if (!pos) return;
    map.flyTo({
      center: pos.lngLat,
      zoom: Math.max(map.getZoom(), 7),
      duration: 800,
      essential: true,
    });
  }

  // ---- live location blip -------------------------------------------------
  // Positioned imperatively off a store subscription: a GPS watch pushes a fix
  // roughly once a second, and this component is far too heavy to re-render on
  // that cadence just to move a dot 8 pixels.
  const paintFix = useCallback((fix: LocationFix | null) => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("location") as maplibregl.GeoJSONSource | undefined;
    if (!fix) {
      blipMarker.current?.remove();
      blipMarker.current = null;
      source?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    if (!blipMarker.current) {
      const el = document.createElement("div");
      el.className = "live-blip";
      el.setAttribute("aria-hidden", "true");
      blipMarker.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(fix.lngLat)
        .addTo(map);
    } else {
      blipMarker.current.setLngLat(fix.lngLat);
    }
    // Only draw the halo when the fix is vague enough for it to mean something;
    // a 5 m ring is invisible noise, and a 2 km one is worth seeing.
    source?.setData({
      type: "FeatureCollection",
      features:
        fix.accuracyM > 25
          ? [
              {
                type: "Feature",
                geometry: { type: "Polygon", coordinates: [circleRing(fix.lngLat, fix.accuracyM)] },
                properties: {},
              },
            ]
          : [],
    });
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    paintFix(useLocation.getState().fix);
    return useLocation.subscribe((s, prev) => {
      if (s.fix !== prev.fix) paintFix(s.fix);
    });
  }, [mapReady, styleEpoch, paintFix]);

  // Permission may already be granted from a previous session — pick the watch
  // back up without prompting, so the blip is simply there on open.
  useEffect(() => {
    useLocation.getState().resumeIfGranted();
  }, []);

  // Tell the traveler what happened instead of just not showing a blip. The
  // text is derived from the status; dismissal only remembers which status was
  // already acknowledged, so a later failure speaks up again.
  const hasCentered = useRef(false);
  useEffect(() => {
    if (locStatus === "idle") hasCentered.current = false;
  }, [locStatus]);

  const locNotice = noticeSeen === locStatus ? null : (LOCATION_NOTICE[locStatus] ?? null);
  useEffect(() => {
    if (!locNotice) return;
    const t = setTimeout(() => setNoticeSeen(locStatus), 6000);
    return () => clearTimeout(t);
  }, [locNotice, locStatus]);

  const centerOnFix = useCallback((zoom = 12) => {
    const map = mapRef.current;
    const fix = useLocation.getState().fix;
    if (!map || !fix) return false;
    map.flyTo({ center: fix.lngLat, zoom: Math.max(map.getZoom(), zoom), duration: 800, essential: true });
    return true;
  }, []);

  // first fix after turning tracking on → bring it on screen
  useEffect(() => {
    if (locStatus !== "live" || hasCentered.current) return;
    if (centerOnFix()) hasCentered.current = true;
  }, [locStatus, centerOnFix]);

  /**
   * The locate button only ever turns tracking *on* and recenters. Switching
   * it off lives in More → My location, where it's a labelled switch: a tap on
   * a 44px crosshair that sometimes means "show me" and sometimes means "stop"
   * is how you end up thinking the blip is broken.
   */
  const handleLocate = useCallback(() => {
    const { status, start } = useLocation.getState();
    if (status === "live") {
      centerOnFix();
      return;
    }
    start();
  }, [centerOnFix]);

  // ---- camera -------------------------------------------------------------------
  const fitTrip = useCallback(() => {
    const map = mapRef.current;
    if (!map || stops.length === 0) return;
    const coords: LngLat[] = stops.map((s) => [s.lng, s.lat]);
    const [minX, minY, maxX, maxY] = bboxOf(coords);
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: { top: 130, bottom: 140, left: 40, right: 40 }, duration: 900 },
    );
  }, [stops]);

  // fly to selected day
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!selectedDayId) return;
    const route = routes[selectedDayId];
    const coords: LngLat[] =
      route && route.coordinates.length > 1
        ? route.coordinates
        : stopsForDay(stops, selectedDayId).map((s) => [s.lng, s.lat] as LngLat);
    if (coords.length === 0) return;
    const [minX, minY, maxX, maxY] = bboxOf(coords);
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: { top: 130, bottom: 160, left: 46, right: 46 }, duration: 800 },
    );
  }, [selectedDayId, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // fly to selected stop
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedStopId) return;
    const stop = stops.find((s) => s.id === selectedStopId);
    if (!stop) return;
    map.flyTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 11),
      duration: 850,
      essential: true,
    });
  }, [selectedStopId, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fit once stops exist — once per app session, not per visit: the
  // persistent map keeps its camera, and stomping it on every return to the
  // tab would throw away wherever the traveler had panned.
  useEffect(() => {
    if (!didInitialFit && mapReady && stops.length > 0) {
      didInitialFit = true;
      fitTrip();
    }
  }, [mapReady, stops, fitTrip]);

  // day the schedule puts us on — drives the plan HUD label
  const planPos =
    showPlan && plan && journey.totalDist > 0 ? positionAtDistance(journey, plan.dist) : null;
  const planDay = planPos && planPos.dayIndex >= 0 ? orderedDays[planPos.dayIndex] : null;
  const planProgress = plan && journey.totalDist > 0 ? plan.dist / journey.totalDist : 0;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* fit-trip control */}
      <button
        onClick={fitTrip}
        aria-label="Zoom to whole trip"
        className="glass pressable absolute right-4 top-[calc(env(safe-area-inset-top)+118px)] z-10 flex h-11 w-11 items-center justify-center rounded-2xl"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M6.5 2H3a1 1 0 0 0-1 1v3.5M11.5 2H15a1 1 0 0 1 1 1v3.5m0 5V15a1 1 0 0 1-1 1h-3.5m-5 0H3a1 1 0 0 1-1-1v-3.5"
            stroke="var(--fg-muted)"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* street / satellite toggle */}
      <button
        onClick={toggleStyle}
        aria-label={styleMode === "street" ? "Switch to satellite" : "Switch to street map"}
        className={`glass pressable absolute right-4 top-[calc(env(safe-area-inset-top)+170px)] z-10 flex h-11 w-11 items-center justify-center rounded-2xl ${
          styleMode === "satellite" ? "text-accent" : "text-fg-muted"
        }`}
      >
        <IconLayers size={18} strokeWidth={1.7} />
      </button>

      {/* show / hide route-shaping handles */}
      <button
        onClick={() => setShowViasPref(!showVias)}
        aria-label={showVias ? "Hide shaping points" : "Show shaping points"}
        className={`glass pressable absolute right-4 top-[calc(env(safe-area-inset-top)+222px)] z-10 flex h-11 w-11 items-center justify-center rounded-2xl ${
          showVias ? "text-accent" : "text-fg-muted"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path
            d="M2 14c3.5 0 3-8.5 7-8.5 2.6 0 3.4 3.4 7 3.2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="9" cy="5.5" r="2.4" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>

      {/* live location — tap to start tracking, again to recenter or stop */}
      <button
        onClick={handleLocate}
        aria-label={locStatus === "live" ? "Recenter on my location" : "Show my location"}
        className={`glass pressable absolute right-4 top-[calc(env(safe-area-inset-top)+274px)] z-10 flex h-11 w-11 items-center justify-center rounded-2xl ${
          locStatus === "live" ? "text-accent" : "text-fg-muted"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="9" cy="9" r="3.1" fill="currentColor" />
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M9 .8v2.2M9 15v2.2M.8 9H3m12 0h2.2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {locStatus === "locating" && (
          <span className="absolute inset-0 animate-ping rounded-2xl border border-accent/50" />
        )}
      </button>

      {/* where we're supposed to be — show/hide the schedule's marker */}
      {journey.totalDist > 0 && (
        <button
          onClick={togglePlan}
          aria-label={showPlan ? "Hide where we should be" : "Show where we should be"}
          className={`glass pressable absolute right-4 top-[calc(env(safe-area-inset-top)+326px)] z-10 flex h-11 w-11 items-center justify-center rounded-2xl ${
            showPlan ? "text-accent" : "text-fg-muted"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <circle cx="9" cy="9" r="6.6" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M9 5.6V9l2.4 1.7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* plan HUD — which day the schedule puts us on, and how we're pacing */}
      <AnimatePresence>
        {showPlan && plan && (
          <motion.div
            {...riseIn()}
            exit={{ opacity: 0, y: 8, transition: FADE }}
            className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+150px)] z-10 flex justify-center px-4"
          >
            <div className="glass-strong flex items-center gap-2.5 rounded-full py-2 pl-3.5 pr-4">
              <span className="text-lg leading-none">{vehicleEmoji(vehicleKey)}</span>
              <div className="min-w-[128px]">
                <p className="truncate text-[11px] font-semibold leading-tight">
                  {planDay ? `Day ${planDay.seq}` : "On the road"}
                  {planDay?.title ? ` · ${planDay.title}` : ""}
                </p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-fg/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round(planProgress * 100)}%`,
                      background: "var(--accent-gradient)",
                    }}
                  />
                </div>
                {plan.deltaM != null && (
                  <p className="mt-1 text-[10px] font-medium leading-tight text-fg-muted">
                    {Math.abs(plan.deltaM) < ON_PACE_M
                      ? "right on schedule"
                      : `${fmtMiles(Math.abs(plan.deltaM))} ${
                          plan.deltaM > 0 ? "ahead of" : "behind"
                        } schedule`}
                  </p>
                )}
              </div>
              <span className="tnum text-xs font-bold text-accent">
                {Math.round(planProgress * 100)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* location trouble — says what happened instead of failing silently */}
      <AnimatePresence>
        {locNotice && (
          <motion.div
            {...riseIn()}
            exit={{ opacity: 0, y: 8, transition: FADE }}
            className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+150px)] z-10 flex justify-center px-6"
          >
            <p className="glass-strong rounded-2xl px-4 py-2.5 text-center text-xs font-medium text-fg-muted">
              {locNotice}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* shaping point delete pill */}
      <AnimatePresence>
        {selectedVia && (
          <motion.div
            {...riseIn()}
            exit={{ opacity: 0, y: 8, transition: FADE }}
            className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+150px)] z-10 flex justify-center"
          >
            <button
              onClick={() => {
                void deleteViaPoint(selectedVia);
                setSelectedVia(null);
              }}
              className="glass-strong pressable rounded-full px-4 py-2.5 text-sm font-medium text-danger"
            >
              Remove shaping point
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
