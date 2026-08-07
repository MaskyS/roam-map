# Roam Map

Roam Map turns ordinary Roam outlines into live maps. The current checkpoint
implements the first edit-render-inspect loop: a `{{map}}` block reads page
references below it, resolves Roam Places location attributes, projects
readable Roam attributes into GeoJSON properties, and keeps one inline
MapLibre map current as those sources change. A map can also contain validated
native MapLibre layers and use page images as runtime style images.

## Current form

```text
{{map}}
  [[[[Cafe]]/Artisan Coffee]]
  [[Port Louis]]
```

Each ordinary descendant source block must resolve to exactly one distinct
page. Put multiple places in separate blocks. Parent blocks may organize those
sources; the compiler walks the descendant outline in block order, deduplicates
by page UID, and retains the contributing block UIDs as provenance.

The canonical spelling is `{{map}}`. `{{[[map]]}}` also mounts, but it creates
an ordinary `[[map]]` page reference as part of Roam's syntax and is therefore
not merely a visual alias. An inline argument such as `{{map: all}}` is parsed
and reported, but it is not executed in this milestone.

Page-backed places are read without changing the graph. The resolver accepts
the current HARC attribute representation, the compatibility attribute
representation, and attributes beneath an exact `roam/meta::` structural
block. It recognizes `Latitude`, `Longitude`, `Geometry`, `Address`, and
`Geocoder ID`. A valid latitude/longitude pair—including zero—is rendered as a
point. Valid non-point GeoJSON geometry is retained by the data boundary and
reported because the first MapLibre layer deliberately draws points only.

The map shows source, mapped, and unmapped counts; diagnostics for skipped or
ambiguous inputs; explicit Refresh and Fit actions; and a selected-place card
that opens the stable page UID in Roam. The MapLibre instance survives source
refreshes, and automatic fitting happens only for the first non-empty result so
later graph edits do not discard the user's viewport.

## Presentation paths

The first configurable slice uses real Roam attributes:

```text
{{map}}
  map/basemap:: satellite
  map/color:: #2457a6
  map/marker:: [[Port Louis]]
    map/color:: #d9822b
    map/radius:: 13
  [[Curepipe]]
```

The whole example above is compatibility spike syntax rather than a settled
public API.
`map/basemap` currently accepts only `streets` or `satellite`; `map/color` and
`map/radius` secretly configure one circle layer; and `map/marker` acts as both
a page source and a per-occurrence styling scope. Those forms proved that real
Roam attributes can drive live presentation, including relationship-scoped
overrides, but they should not duplicate or obscure MapLibre's style, source,
layer, and expression model.

The composable path now accepts validated native MapLibre layers over the
stable GeoJSON source compiled for the map. Arbitrary style URLs and
user-defined sources remain later work. Named presets can remain conveniences
if they compile to this same layer path. Roam Map still needs a generic
occurrence scope because attaching configuration beneath a bare
`[[Port Louis]]` block can cause Roam's current attribute model to describe the
referenced page rather than this map occurrence; that scope should not be
permanently tied to the word `marker`.

See [PRESENTATION.md](./PRESENTATION.md) for the concept-by-concept contract
between Roam attributes, GeoJSON feature properties, native MapLibre
expressions, image resources, and map-wide global state. That guide also marks
which parts remain hypotheses requiring live verification.

The reader supports Roam's current HARC representation and its legacy
compatibility representation. Invalid values appear as local diagnostics and
fall back to the inherited defaults. Changes use the same pull-watch path as
source edits, so the map should update without a Roam reload.

The satellite preset is an experiment, not a production-provider decision. It
uses the same EOxCloudless 2020 raster endpoint as MapLibre's
[satellite example](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-satellite-map/)
and provides the required attribution through the MapLibre source. Current
[EOxCloudless terms](https://cloudless.eox.at/documentation/license) allow
free non-commercial use with attribution; commercial use requires the
applicable EOX licence. A production release must not describe this preset as
unconditionally free.

### Native MapLibre layer form

The durable form is a readable `MapLibre layer` block with exactly one ordinary
code-block child containing strict JSON. Roam may display that child with its
generic `javascript` language label; the content is still parsed as JSON.
`roam-map-features` is the stable ID of the GeoJSON source compiled from the
surrounding Roam inputs. Each layer is validated with the pinned MapLibre style
specification before it reaches the map. Layer IDs must be distinct, and IDs
beginning with `roam-map/` are reserved for the extension.

A circular point marker chooses its shape with the MapLibre layer `type` and
its size with `circle-radius`, whose unit is pixels:

````text
{{map}}
  [[Port Louis]]
  [[Curepipe]]
  MapLibre layer
    ```json
    {
      "id": "places",
      "type": "circle",
      "source": "roam-map-features",
      "paint": {
        "circle-radius": 10,
        "circle-color": "#6f42c1",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    }
    ```
````

There is therefore no general `map/marker-shape:: circle` or
`map/marker-size:: 10`. Different MapLibre layer types have different sizing
rules. A symbol marker uses a registered image and `icon-size`, which is a
multiplier of that image's intrinsic dimensions:

````text
{{map}}
  [[People]]/Andy Matuschak
  [[People]]/Bret Victor
  MapLibre layer
    ```json
    {
      "id": "people",
      "type": "symbol",
      "source": "roam-map-features",
      "filter": ["has", "Profile Picture"],
      "layout": {
        "icon-image": [
          "coalesce",
          ["image", ["concat", ["get", "Profile Picture"], "#circle"]],
          ["image", "roam-map/default-marker"]
        ],
        "icon-size": 1,
        "icon-overlap": "always"
      }
    }
    ```
````

The compiler exposes suitable scalar attributes under their readable attribute
page titles. It therefore projects `[[Profile Picture]]` as the feature key
`Profile Picture`, while retaining the attribute page UID internally for Roam
reads, watches, and provenance. Exact HTTP(S) image Markdown becomes an opaque
runtime image ID rather than exposing the URL to MapLibre expressions.

Images are loaded through Roam's supported file API when they are Roam-hosted,
center-cropped to 64 by 64 physical pixels, and registered with
`pixelRatio: 2`. They therefore display at 32 CSS pixels when `icon-size` is
`1`. Each image keeps its square token and also registers an alpha-clipped
`<token>#circle` variant. The People layer chooses that variant with MapLibre's
native [`concat`
expression](https://maplibre.org/maplibre-style-spec/expressions/#concat) and
registers both forms through
[`Map.addImage`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#addimage).
Runtime images, authored layers, and the registered fallback image are restored
after a basemap style replacement. A base circle layer remains below the
portrait layer, so a missing or broken portrait still leaves an ordinary point
visible.

MapLibre does not have a symbol-layer property that clips arbitrary photographs
into circles. Roam Map therefore creates transparent circular pixels before it
calls `map.addImage`, while preserving the square registration for other maps.
The layer still uses an ordinary MapLibre image expression rather than a
competing marker-style language.

MapLibre also documents an [HTML Marker
approach](https://maplibre.org/maplibre-gl-js/docs/examples/add-custom-icons-with-markers/)
that uses `border-radius: 50%`. That is useful for rich DOM markers, but it is a
separate rendering path rather than a `LayerSpecification`. This checkpoint
keeps portraits in native symbol layers so direct and future query-fed maps can
share the same expressions, filters, ordering, and asset lifecycle.

## Planned source forms

These examples describe the next adapters. They do not execute yet:

```text
{{map: {and: [[Cafe]] [[Mauritius]]}}}
```

```text
{{map}}
  Cafes
    {{query: {and: [[Cafe]] {not: [[Closed]]}}}}
  Search results
    {{[[search]]: coffee Mauritius}}
  Reusable collection
    ((source-block-uid))
```

Coordinates, explicit page/block UID lists, native queries, search components,
`:q`, reusable source outlines, GeoJSON, and richer MapLibre resources are
separate input kinds. They converge on typed features or native resources
rather than being forced through synthetic place pages.

## Product boundary

- Roam is the editor and the durable source of truth.
- `{{map}}` aggregates sources and renders geographic features; it does not
  rewrite source outlines or location pages.
- Roam Places owns place capture. Roam Map owns persistent maps, layers,
  geometry rendering, and map interaction.
- Roam entity sources resolve through stable page or block UIDs. Direct
  coordinates and external features retain explicit source-derived identity.
- Page UID is the identity of a page-backed place. Titles are presentation and
  may change.
- Map state is ephemeral unless the user explicitly saves a view.

## First product-intuition loop

The first milestone is intentionally small:

1. Type or edit a `{{map}}` block and its child page references.
2. See the map mount and update without reloading Roam.
3. See located pages as markers and understand why other inputs were skipped.
4. Click a marker to return to its Roam page.
5. Change a projected page attribute or a native layer and see the MapLibre
   presentation update without recreating place data.
6. Repeat quickly enough that the outline feels like a map REPL.

Native queries, search components, reusable block-reference collections,
Datalog, polygons, clustering, presets, and saved presentation settings build
on that loop.

## Development

Roam Map is a local-folder Roam Depot extension. It produces the Depot entry
artifacts `extension.js` and `extension.css` at the repository root; both are
generated and ignored by Git.

```bash
npm install
npm run dev       # rebuild on source changes
npm run check     # tests, production build, and bundle guard
```

Load this repository through **Settings → Roam Depot → Load local folder**.
After a production rebuild, reload developer extensions with
`roam reload-dev-extensions --graph <graph>` or `Ctrl-D Ctrl-R`.

Roam supplies React 18.2.0, `ReactDOMClient`, Blueprint, and the other globals
listed in Roam's current
[Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries)
documentation. The build uses those React globals and verifies that it did not
bundle a second React runtime. MapLibre GL JS 5.24.0 is pinned and bundled once.
The default basemap is OpenFreeMap's Liberty style, so tiles require network
access and the renderer keeps provider and OpenStreetMap attribution visible.
The experimental satellite preset and its licensing boundary are described
above.

The `{{map}}` mounting adapter is intentionally isolated in one module because
Roam does not currently document registration of arbitrary inline parser
tokens. It observes Roam's fallback map button only to discover a visible
mount; all semantic reads, page navigation, and invalidation use the documented
Roam Alpha API.

See [DESIGN.md](./DESIGN.md) for the concise source contract and delivery
sequence, [PRESENTATION.md](./PRESENTATION.md) for the Roam-to-MapLibre
presentation walkthrough and verification guide, and
[ARCHITECTURE.md](./ARCHITECTURE.md) for the detailed Roam and ProseMirror
rationale.
