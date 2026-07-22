"use client";

import maplibregl, {
  Map as MLMap,
  Marker,
  type ExpressionSpecification,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT, MAP_STYLE_SATELLITE } from "@/lib/config";
import { IconLayers } from "./Icons";
import { clusterKey, clusterStops } from "@/lib/clusters";
import { dayColor } from "@/lib/colors";
import { bboxOf, type LngLat } from "@/lib/geo";
import { FADE, riseIn } from "@/lib/motion";
import { SUGGESTION_CATEGORIES } from "@/lib/overpass";
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

const CATEGORY_ICON = Object.fromEntries(
  SUGGESTION_CATEGORIES.map((c) => [c.key, c.icon]),
) as Record<string, string>;

/** Route source + line layers — added on load and re-added after setStyle. */
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

export default function MapView({ onSelectStop, onLongPress }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const stopMarkers = useRef(new Map<string, { marker: Marker; dayId: string }>());
  const viaMarkers = useRef(new Map<string, Marker>());
  const weatherMarkers = useRef(new Map<string, { marker: Marker; dayId: string }>());
  const suggestionMarkers = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
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

  // ---- init ---------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const dark = effectiveDark();
    const initialMode: StyleMode =
      localStorage.getItem(STYLE_PREF_KEY) === "satellite" ? "satellite" : "street";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style:
        initialMode === "satellite"
          ? (MAP_STYLE_SATELLITE as StyleSpecification)
          : dark
            ? MAP_STYLE_DARK
            : MAP_STYLE_LIGHT,
      center: [-122.6, 40.5],
      zoom: 4.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // test hook (harmless in production)
    (window as unknown as { __coastlineMap?: MLMap }).__coastlineMap = map;

    map.on("load", () => {
      addRouteLayers(map, initialMode, dark);

      // Tap the line → drop a shaping point in that gap.
      map.on("click", "route-line", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const dayId = feature.properties?.dayId as string;
        fireRouteTap(dayId, [e.lngLat.lng, e.lngLat.lat]);
        e.preventDefault();
      });
      map.on("mouseenter", "route-line", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "route-line", () => (map.getCanvas().style.cursor = ""));

      setMapReady(true);
    });

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
      pressTimer = setTimeout(() => fireLongPress(lngLat), 550);
    });
    map.on("touchmove", (e) => {
      if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 12) cancel();
    });
    map.on("touchend", cancel);
    // touchcancel (not touchend) fires when iOS steals the touch for a system
    // gesture — without this the timer still fires a phantom long-press
    map.on("touchcancel", cancel);
    map.on("dragstart", cancel);

    const sm = stopMarkers.current;
    const vm = viaMarkers.current;
    const wm = weatherMarkers.current;
    return () => {
      map.remove();
      mapRef.current = null;
      sm.clear();
      vm.clear();
      wm.clear();
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
  // the not-yet-fired style.load handler from the previous toggle, if any
  const pendingStyleLoad = useRef<(() => void) | null>(null);
  const toggleStyle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next: StyleMode = styleMode === "street" ? "satellite" : "street";
    setStyleMode(next);
    localStorage.setItem(STYLE_PREF_KEY, next);
    const dark = effectiveDark();
    // setStyle wipes sources/layers; rebuild them once the new style is in.
    // Listen BEFORE calling setStyle — inline style objects (satellite) can
    // finish loading synchronously, so a later .once() would miss the event
    // and the route line would vanish until the map remounts.
    // A rapid double-toggle can leave the previous once() still armed; both
    // would fire on the final style.load and the stale one wins the layer
    // creation with the wrong palette — drop it first.
    if (pendingStyleLoad.current) map.off("style.load", pendingStyleLoad.current);
    const onStyleLoad = () => {
      pendingStyleLoad.current = null;
      addRouteLayers(map, next, dark);
      setStyleEpoch((e) => e + 1);
    };
    pendingStyleLoad.current = onStyleLoad;
    map.once("style.load", onStyleLoad);
    map.setStyle(
      next === "satellite"
        ? (MAP_STYLE_SATELLITE as StyleSpecification)
        : dark
          ? MAP_STYLE_DARK
          : MAP_STYLE_LIGHT,
    );
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
      // guard: on unmount the init effect's cleanup has already torn the map down
      if (mapRef.current !== map) return;
      if (drawAnim.current) {
        cancelAnimationFrame(drawAnim.current.raf);
        drawAnim.current = null;
      }
      removeOverlay();
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

  // initial fit once routes + stops exist
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!didInitialFit.current && mapReady && stops.length > 0) {
      didInitialFit.current = true;
      fitTrip();
    }
  }, [mapReady, stops, fitTrip]);

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
