# Roam Map

Roam Map turns ordinary Roam outlines into live, persistent maps. Add location
pages, coordinate blocks, a saved native query, or a fenced Datalog query
beneath `{{map}}`; Roam Map resolves stable page and block UIDs, keeps known
locations current as the graph changes, and lets you return to the underlying
entity.

![A Roam Map showing five places, its toolbar, a marker card, and the source outline](https://raw.githubusercontent.com/MaskyS/roam-map/main/assets/roam-map-basic-example.webp)

Need to find or create location pages while you write? [Roam Places](https://github.com/MaskyS/roam-places)
searches your graph and online place services, then saves the location data
Roam Map reads. Roam Places handles location capture; Roam Map handles
aggregation and persistent map rendering.

## Quick start

Create or reuse pages with a WGS84 `Coordinates` attribute. Roam Places can
capture it for you:

```text
roam/meta::
  Coordinates:: geo:-20.1609,57.5012
```

Then add a map to any outline:

```text
{{map}}
  [[Port Louis]]
  [[Curepipe]]
```

Put each place reference in its own descendant block. Parent blocks may group
places. A map may also contain block-backed points:

```text
{{map}}
  geo:-20.1609,57.5012;u=14.4
  Curepipe meeting point
    Coordinates:: geo:-20.3163,57.5251
```

Roam Map walks the outline in order and deduplicates repeated sources by their
stable page or block UID.

For dynamic membership, a direct-child native `{{query}}` keeps returned pages
as pages and maps each returned block through its containing page. A direct-child
`clojure`, `clj`, `datalog`, `datascript`, or `commonlisp` code block can instead
run Datalog that returns an exact flat UID collection or one-column UID relation.
The live Efforts fixture uses a native query; the People and relationship-aware
San Francisco fixtures use Datalog. Use **Refresh** when a previously unrelated
entity becomes a new match.

The map provides:

- mapped, unmapped, and source counts, with a results list whose rows highlight
  and focus places without opening marker actions;
- live updates when sources, locations, or presentation attributes change;
- explicit **Refresh** and **Fit** controls;
- a corner resize grip that saves one readable, responsive map size;
- named basemap previews without silently saving view state;
- marker cards that open source pages or blocks in Roam's right sidebar; and
- local diagnostics when an input cannot be mapped.

## Tested examples

The complete working recipes—including circular image markers, native
MapLibre layers, a reusable JSX marker popup with image, description, and
website data, a real external style URL, and a saved satellite context map—are
in:

![A People map using profile-picture markers and graph-authored MapLibre layers](https://raw.githubusercontent.com/MaskyS/roam-map/main/assets/roam-map-people-layers.webp)

**[Open the tested Roam Map examples →](https://github.com/MaskyS/roam-map/blob/main/examples.md)**

**[Read the complete customization reference →](https://github.com/MaskyS/roam-map/blob/main/customization.md)**

The examples are kept outside this README so the description remains readable
inside **Settings → Roam Depot → Roam Map**.

## Location data

Roam Map reads page- and block-backed locations without rewriting them. It
supports Roam's current attribute representation and its compatibility
representation, including attributes beneath an exact `roam/meta::` block.

Recognized location fields are:

- `Coordinates`
- `Geometry`
- `Address`
- `Geocoder ID`

`Coordinates` must be a plain two-dimensional WGS84 `geo:` URI with latitude
first and longitude second. The optional `u` parameter records uncertainty in
metres. A valid value—including zero—renders as a point. The current renderer
intentionally reports non-point GeoJSON rather than pretending to draw it as a
marker.

## Basemaps

OpenFreeMap Liberty is the default. The built-in keyless catalog also includes
OpenFreeMap Positron, Bright, Dark, and Fiord, plus `EOX Satellite Context`—a
2016 global Sentinel-2 context mosaic rather than current high-resolution
imagery.

Save a basemap visibly in the map outline:

```text
{{map}}
  map/basemap:: OpenFreeMap Dark
  [[Port Louis]]
```

A graph administrator can open **Basemap catalog** in the Roam Map settings and
add either a complete MapLibre style URL or an attributed raster tile template.
Configure the URL once, give it a readable name, and use that name from any map.
The optional MapTiler shortcut adds `MapTiler Satellite` and `MapTiler Hybrid`
without making MapTiler the only configurable provider.

Roam Map preserves provider and OpenStreetMap attribution behind the map's
standard compact ⓘ control, one click away at the bottom-right corner.

Extension settings are graph-synced, so configured URLs and browser keys are
collaborator-visible public configuration, not secrets. The
[working external-style example](https://github.com/MaskyS/roam-map/blob/main/examples.md#external-maplibre-style-url)
uses a real URL that Roam Map does not provide. The
[customization reference](https://github.com/MaskyS/roam-map/blob/main/customization.md#basemaps-names-resolve-to-maplibre-styles)
explains style URLs, raster templates, attribution, credentials, and CORS.

## Presentation and customization

Hover over a map to reveal its small resize grip just outside the bottom-right
corner. Drag it to change the map's maximum width and height. Roam Map saves both dimensions
atomically in a normal child such as
`map/size:: 900 × 480`; **Reset map size** restores responsive defaults. A
saved maximum width never exceeds the space Roam provides, and camera movement
is not saved.

Roam Map exposes every suitable scalar source attribute to the compiled GeoJSON
feature under its readable attribute title. Advanced maps can use ordinary,
validated MapLibre layers over the stable source ID `roam-map-features`.

Add each layer as a readable `MapLibre layer` block with exactly one ordinary
code-block child containing strict JSON:

````text
MapLibre layer
  ```json
  {
    "id": "large-places",
    "type": "circle",
    "source": "roam-map-features",
    "paint": {
      "circle-radius": 10,
      "circle-color": "#6f42c1"
    }
  }
  ```
````

The default marker card is replaceable with arbitrary user-authored
`roam/render` code:

````text
Marker click
  ```jsx
  function customMarkerClick({ args }) {
    const context = JSON.parse(decodeURIComponent(args[1]));
    return <div>{context.feature.properties["roam/label"]}</div>;
  }
  ```
````

`Marker click` may instead contain one exact block reference to reusable code.
JavaScript, JSX, and Clojure code blocks are accepted. Custom code can render
any interface, reuse Roam Map's stock Blueprint components, query additional
graph data through `entityUid`, run an effect such as sound or confetti, or
return `null`.

The versioned `window.RoamMap.components` namespace currently exports:

- `MarkerPopover`
- `MarkerCard`
- `MarkerCardDetails`
- `MarkerCardActions`
- `MapResultsPanel`
- `MapResultItem`

The stock fallback uses those same components. Roam Map invokes custom code
through Roam's documented `renderString` API and calls `unmountNode` during
cleanup. Enable Roam's custom-components setting before using graph-authored
code, and treat that code with the same trust as any other `roam/render`
component.

See the [tested popup recipe](https://github.com/MaskyS/roam-map/blob/main/examples.md#custom-effort-popup)
for the complete click context and a human-readable JSX component that reads
`Image::`, `Description::`, and `URL::` through the Roam Alpha API.

## Current scope

Implemented source membership is deliberately explicit: ordinary descendant
page references, bare `geo:` blocks, named blocks with a `Coordinates`
attribute, result pages or the containing pages of result blocks from a
direct-child native query, and exact page or block UIDs returned by a
direct-child fenced Datalog query. Either dynamic definition may be reused
through one exact direct-child block reference. Inline arguments such as
`{{map: all}}`, search components, saved `:q` components, reusable source
outlines, arbitrary GeoJSON sources, lines, polygons, clustering, and saved
camera views remain separate work.

Roam Map owns aggregation and rendering. Roam remains the editor and durable
source of truth, and Roam Places remains responsible for capturing locations.
Rendering never rewrites source blocks or location pages as a side effect.

## Help, design, and development

- [Tested examples](https://github.com/MaskyS/roam-map/blob/main/examples.md)
- [Customization reference](https://github.com/MaskyS/roam-map/blob/main/customization.md)
- [Presentation and MapLibre contract](https://github.com/MaskyS/roam-map/blob/main/PRESENTATION.md)
- [Design notes](https://github.com/MaskyS/roam-map/blob/main/DESIGN.md)
- [Architecture and lifecycle](https://github.com/MaskyS/roam-map/blob/main/ARCHITECTURE.md)
- [Issues and planned work](https://github.com/MaskyS/roam-map/issues)

For local development:

```bash
npm install
npm run dev
npm run check
```

Load the repository through **Settings → Roam Depot → Load local folder**.
Roam supplies React 18.2.0 and Blueprint; the build externalizes those globals.
MapLibre GL JS 5.24.0 is pinned and bundled once.
