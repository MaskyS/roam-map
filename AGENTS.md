# Roam Map contributor instructions

Roam Map is a deliberately narrow Roam Depot extension for persistent maps.

## Product boundary

- Roam owns editing and durable data.
- Roam Places owns place capture; Roam Map owns source aggregation and map
  rendering.
- Normalize all sources to page UIDs before reading geographic data.
- Never rewrite user source blocks or location pages as a rendering side effect.
- Do not use query-result DOM as data. Use the Roam Alpha API.
- Keep point, geometry, provenance, and layer data independent of MapLibre
  objects.

## Development approach

1. Read the applicable current pages on https://roamdocs.fyi before changing a
   Roam protocol or UI seam.
2. Make the smallest change that improves the live edit/render/inspect loop.
3. Prefer documented Alpha and Extension APIs. Isolate unavoidable DOM
   integration behind one lifecycle boundary.
4. Test mount/unmount cleanup, duplicate renders, source invalidation, and
   conservative graph reads.
5. Verify important behavior in live Roam, not only in DOM mocks.

## Safety

- Clean up observers, pull watches, React roots, maps, markers, requests, and
  listeners on unmount and extension unload.
- Treat the same block rendered in different windows as distinct UI instances.
- Keep network attribution visible.
- Do not persist pan/zoom continuously. Save presentation state only through an
  explicit user action.

