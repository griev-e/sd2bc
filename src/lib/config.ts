// Supabase publishable credentials. The publishable key is safe to ship to
// clients by design — all access is gated by Row Level Security. Env vars
// take precedence so the project can be repointed without a code change.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://rfrzvyklvsozhngcgxis.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable__Xv-ME9hUoGy68Ezv1q56g_93_1Tc7a";

export const OSRM_URL = "https://router.project-osrm.org";
export const OVERPASS_URL = "/api/overpass";
/**
 * QLever's full-planet OSM SPARQL endpoint. Its spatial index answers the
 * "POIs near a route corridor" question in seconds, where the same query
 * routinely blows past public Overpass instances' 30s timeout. CORS is open,
 * so the browser can query it directly.
 */
export const QLEVER_OSM_URL = "https://qlever.dev/api/osm-planet";

/** Free Esri World Imagery raster style for the satellite map mode. */
export const MAP_STYLE_SATELLITE = {
  version: 8 as const,
  sources: {
    "esri-imagery": {
      type: "raster" as const,
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Powered by <a href='https://www.esri.com'>Esri</a> — Maxar, Earthstar Geographics, GIS User Community",
    },
  },
  layers: [{ id: "esri-imagery", type: "raster" as const, source: "esri-imagery" }],
};
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org";

export const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
export const MAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

export const TRIP_START = "2026-07-27";
