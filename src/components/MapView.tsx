"use client";

import maplibregl, { Map as MLMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { MAP_STYLE_DARK, MAP_STYLE_LIGHT } from "@/lib/config";
import { dayColor } from "@/lib/colors";
import { bboxOf, type LngLat } from "@/lib/geo";
import { insertShapingPoint } from "@/lib/shaping";
import { stopsForDay, useTrip } from "@/lib/store";
import type { Stop } from "@/lib/types";

interface MapViewProps {
  onSelectStop: (stop: Stop) => void;
  onLongPress?: (lngLat: LngLat) => void;
}

export default function MapView({ onSelectStop, onLongPress }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const stopMarkers = useRef(new Map<string, Marker>());
  const viaMarkers = useRef(new Map<string, Marker>());
  const [mapReady, setMapReady] = useState(false);
  const [selectedVia, setSelectedVia] = useState<string | null>(null);

  // Stable identities for callbacks used inside the one-shot map init effect.
  const fireLongPress = useEffectEvent((lngLat: LngLat) => onLongPress?.(lngLat));
  const fireSelectStop = useEffectEvent((stop: Stop) => onSelectStop(stop));

  const days = useTrip((s) => s.days);
  const stops = useTrip((s) => s.stops);
  const viaPoints = useTrip((s) => s.viaPoints);
  const routes = useTrip((s) => s.routes);
  const selectedDayId = useTrip((s) => s.selectedDayId);
  const selectedStopId = useTrip((s) => s.selectedStopId);
  const moveViaPoint = useTrip((s) => s.moveViaPoint);
  const deleteViaPoint = useTrip((s) => s.deleteViaPoint);
  const setSelectedStop = useTrip((s) => s.setSelectedStop);

  const orderedDays = [...days].sort((a, b) => a.seq - b.seq);
  const dayIndex = new Map(orderedDays.map((d, i) => [d.id, i]));

  // ---- init ---------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: dark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center: [-122.6, 40.5],
      zoom: 4.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // test hook (harmless in production)
    (window as unknown as { __coastlineMap?: MLMap }).__coastlineMap = map;

    map.on("load", () => {
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
          "line-color": dark ? "#0a0f13" : "#ffffff",
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

      // Tap the line → drop a shaping point in that gap.
      map.on("click", "route-line", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const dayId = feature.properties?.dayId as string;
        void insertShapingPoint(dayId, [e.lngLat.lng, e.lngLat.lat]);
        e.preventDefault();
      });
      map.on("mouseenter", "route-line", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "route-line", () => (map.getCanvas().style.cursor = ""));

      setMapReady(true);
    });

    // Long-press → add a real stop here.
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStart: { x: number; y: number } | null = null;
    map.on("touchstart", (e) => {
      if (e.points.length !== 1) return;
      pressStart = { x: e.point.x, y: e.point.y };
      const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
      pressTimer = setTimeout(() => fireLongPress(lngLat), 550);
    });
    const cancel = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
      pressStart = null;
    };
    map.on("touchmove", (e) => {
      if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 12) cancel();
    });
    map.on("touchend", cancel);
    map.on("dragstart", cancel);

    const sm = stopMarkers.current;
    const vm = viaMarkers.current;
    return () => {
      map.remove();
      mapRef.current = null;
      sm.clear();
      vm.clear();
    };
     
  }, []);


  // ---- route layers ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const features = orderedDays
      .map((d, i) => {
        const route = routes[d.id];
        if (!route || route.coordinates.length < 2) return null;
        const dim = selectedDayId !== null && selectedDayId !== d.id;
        return {
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: route.coordinates },
          properties: {
            dayId: d.id,
            color: dayColor(i, orderedDays.length),
            opacity: dim ? 0.18 : 0.95,
          },
        };
      })
      .filter(Boolean);
    source.setData({
      type: "FeatureCollection",
      features: features as GeoJSON.Feature[],
    });
  }, [routes, selectedDayId, mapReady, orderedDays.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- stop markers -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const [, m] of stopMarkers.current) m.remove();
    stopMarkers.current.clear();

    for (const day of orderedDays) {
      const i = dayIndex.get(day.id) ?? 0;
      const color = dayColor(i, orderedDays.length);
      const dim = selectedDayId !== null && selectedDayId !== day.id;
      const dayStops = stopsForDay(stops, day.id);
      dayStops.forEach((stop, si) => {
        const el = document.createElement("div");
        el.className = `stop-marker${stop.is_overnight ? " overnight" : ""}`;
        el.style.background = color;
        el.style.opacity = dim ? "0.35" : "1";
        el.textContent = String(si + 1);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setSelectedStop(stop.id);
          fireSelectStop(stop);
        });
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([stop.lng, stop.lat])
          .addTo(map);
        stopMarkers.current.set(stop.id, marker);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, days, selectedDayId, mapReady]);


  // highlight the selected stop without rebuilding markers
  useEffect(() => {
    for (const [id, marker] of stopMarkers.current) {
      marker.getElement().classList.toggle("selected", id === selectedStopId);
    }
  }, [selectedStopId, stops]);

  // ---- via (shaping) markers ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const [, m] of viaMarkers.current) m.remove();
    viaMarkers.current.clear();

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
  }, [viaPoints, mapReady]);

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

      {/* shaping point delete pill */}
      {selectedVia && (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+150px)] z-10 flex justify-center">
          <button
            onClick={() => {
              void deleteViaPoint(selectedVia);
              setSelectedVia(null);
            }}
            className="glass-strong pressable rise-in rounded-full px-4 py-2.5 text-sm font-medium text-danger"
          >
            Remove shaping point
          </button>
        </div>
      )}
    </div>
  );
}
