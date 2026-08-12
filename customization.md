# Customizing Roam Map

This is the canonical reference for humans and coding agents changing a Roam
Map's sources, data, basemap, layers, images, or marker interaction. It describes
what the current extension implements. Copyable, live-tested recipes are in
[`examples.md`](https://github.com/MaskyS/roam-map/blob/main/examples.md).

## The six concepts to keep separate

| Concept | What it controls | Current authoring surface |
| --- | --- | --- |
| Sources | Which Roam entities belong on this map | Descendant page references and coordinate blocks, or direct-child native-query and Datalog definitions that return entity UIDs |
| Feature data | A source entity's location and presentation values | Page or block attributes read through the Roam Alpha API |
| Map size | Responsive maximum width and height | Corner grip or one `map/size` attribute beneath `{{map}}` |
| Basemap | The geographic context beneath the features | A named catalog entry selected with `map/basemap` |
| Layers | How compiled features are drawn | Validated MapLibre layer JSON |
| Interaction | What happens after a marker click | Stock components or a user-authored `Marker click` component |

Roam is the editor and durable source of truth. Roam Map compiles those inputs
into data and presentation resources; it does not rewrite source blocks or
location entities while rendering.

## Supported authoring forms at a glance

| Form | Status | Meaning |
| --- | --- | --- |
| `{{map}}` with descendant page references | Supported | Map those page-backed locations in outline order |
| Bare `geo:latitude,longitude` descendant block | Supported | Map that block as an unnamed point |
| Named descendant block with `Coordinates:: geo:…` | Supported | Map that block as a named point |
| Native `{{query}}` direct child | Supported | Execute the saved query by block UID; keep page results and map block results through their containing pages |
| Fenced Datalog direct child | Supported | Execute Datalog and map a flat collection or one-column relation of page or block UIDs |
| Direct-child block reference to either dynamic definition | Supported | Reuse one saved native query or fenced Datalog block |
| `Coordinates`, `Geometry`, `Address`, `Geocoder ID` | Supported | Location and core place data |
| Other scalar source attributes | Supported | Readable feature properties for MapLibre expressions |
| `map/size:: 900 × 480` | Supported | One atomic maximum-width and height preference for this map definition |
| Resize grip outside the bottom-right corner | Supported | Appears on map hover; previews while dragging and writes `map/size` once when released |
| `map/basemap:: Catalog name` | Supported | Durable, per-map selection of a configured basemap |
| Toolbar basemap selector | Supported | Transient preview; does not write to Roam |
| Complete MapLibre style URL in **Basemap catalog** | Supported | Add a reusable named external style |
| Raster tile template in **Basemap catalog** | Supported | Generate a style with attribution and tile metadata |
| `MapLibre layer` plus one JSON code block | Supported | Add a validated layer over `roam-map-features` |
| HTTP(S) image Markdown in an attribute | Supported | Register square and circular runtime image variants |
| `Marker click` plus inline code or one block reference | Supported | Replace the stock marker behavior with `roam/render` code |
| `Results list` plus inline code or one block reference | Supported | Replace the stock results list with `roam/render` code |
| Default synchronized results list | Supported | Open the text-first source list from the place-count control |
| Raw style or tile URL in `map/basemap` | **Not supported** | Configure it once under a name; unknown text falls back to Liberty |
| Inline complete style JSON or arbitrary map-local sources | **Not supported yet** | Requires a distinct validated resource surface |
| Search components | **Not planned** | Use a saved native query or fenced Datalog instead |
| Saved `:q` components | **Not supported** | Put the Datalog text in a supported fenced direct child instead |
| Reusable source outlines | **Not planned** | Keep curated page references local, or reference one saved query or Datalog definition |
| Raw Datalog or source expressions inside `{{map: ...}}` | **Not supported** | Put a supported definition in a child block instead |
| Lines, polygons, or clustering | **Not supported yet** | Separate rendering capabilities |
| Saved camera state | **Not planned** | Center, zoom, bearing, and pitch remain transient per visible map instance |

If a form is marked unsupported, do not place it in a working example or teach
the compiler to guess what the author meant.

## Sources: which entities appear

An ordinary descendant block can resolve to one distinct page:

```text
{{map}}
  Mauritius
    [[Port Louis]]
    [[Curepipe]]
```

The compiler also accepts two block-backed point forms:

```text
{{map}}
  geo:-20.1609,57.5012;u=14.4
  Curepipe meeting point
    Coordinates:: geo:-20.3163,57.5251
    Address:: Curepipe, Mauritius
```

The first source is the `geo:` block itself. Its label is the readable
latitude and longitude. The second source is the named parent block; its child
attributes provide the point and optional presentation data. `Coordinates`
may instead sit beneath one exact `roam/meta::` child.

`Coordinates` is a plain two-dimensional WGS84 `geo:` URI, not a Markdown
link. Latitude comes first and longitude second. The optional `u` parameter is
non-negative uncertainty in metres. Roam Map accepts an explicit
`;crs=wgs84`, but no other CRS, altitude, unknown parameters, exponent
notation, or trailing prose.

The compiler walks descendants in block order, uses the stable page or block
UID as identity, and retains source block UIDs as provenance. Put multiple
page sources in separate blocks. One block containing multiple distinct page
references is ambiguous and produces a diagnostic. If a block has its own
`Coordinates` attribute as well as page references, its explicit block-backed
location is the source for that block.

`{{[[map]]}}` also mounts, but Roam creates a real `[[map]]` page reference as
part of that spelling. `{{map: all}}` is retained and reported but is not a
planned source adapter. Use an explicit saved query or fenced Datalog when a
map should scan broadly, so the potentially expensive membership rule remains
visible and editable in Roam.

### Saved native queries: containing pages

Put an ordinary saved Roam query component directly beneath the map:

```text
{{map}}
  {{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

Roam Map executes that component by its stable block UID through Roam's Alpha
API. It does not inspect rendered query-result DOM. A returned page stays a page.
For a returned block, Roam Map reads Roam's `:block/page` relationship and uses
that containing page as the map entity. The result block UID remains source
provenance, while feature identity, label, location lookup, and navigation use
the page UID. Multiple matching blocks on one page deduplicate to one place.

The live Efforts fixture uses that query to return each matching `roam/meta::`
block. Roam Map maps the containing Effort pages, so marker labels and
navigation identify the Efforts instead of displaying `roam/meta::`; location
metadata is then read from those pages in the ordinary way.

This is **containing-page** resolution, not referenced-page inference. Roam Map
does not guess which page mentioned by a result block is the intended place. A
native query that returns a `Went to [[Restaurant]]` block on a daily note maps
the daily-note page, not `[[Restaurant]]`. When the desired map entity differs
from the containing page, use Datalog to return its page UID explicitly.
Datalog also retains exact block UID semantics for genuinely block-backed
points.

The native-query adapter asks Roam for at most 250 results and reports when the
saved query has more. Its saved query-builder clauses, filters, and sort settings
remain Roam-owned. Query criteria and child blocks are configuration, never
accidental map sources.

### Datalog sources: an explicit UID collection

For relationships that the native query UI cannot express precisely, put one
fenced Datalog code block directly beneath the map. This live-tested query
shape returns `[[San Francisco]]/…` pages referenced in the same daily-note
block as a Person page. Replace the placeholder Person title with one from
your graph:

````text
{{map}}
  ```clojure
  [:find [?place-uid ...]
   :where
   [?person :node/title "[[People]]/Example Person"]
   [?place :node/title ?place-title]
   [(clojure.string/starts-with? ?place-title "[[San Francisco]]/")]
   [?mention :block/refs ?person]
   [?mention :block/refs ?place]
   [?mention :block/page ?daily-page]
   [?daily-page :log/id ?date]
   [?place :block/uid ?place-uid]]
  ```
````

The repeated `?mention` variable requires both references to occur in the same
block. The `:log/id` clause establishes that the block belongs to a daily note,
and the `:find` returns the Place UID rather than the mention block. On the
development fixture it maps the returned namespaced pages once those pages
have Roam Places metadata.

The live test repeats the same query shape with a second placeholder Person
page. Any page renames or geocoding needed to make those results mappable are
explicit graph-editing work; Roam Map does not perform them while rendering.

The result contract is intentionally small. A Datalog source must return either
a flat array of non-empty UID strings, normally produced by
`[:find [?uid ...] ...]`, or a one-column relation, normally produced by
`[:find ?uid ...]`. Multiple columns, scalar values, titles, entity IDs, maps,
and mixed result shapes are rejected rather than guessed. Duplicate UIDs are
removed in result order, and only the first 250 unique UIDs are pulled and
mapped. The query itself runs before that cap is applied.

The supported fence labels are `clojure`, `clj`, `datalog`, `datascript`, and
`commonlisp`. The fence is stored as ordinary graph data and is executed with
Roam's documented asynchronous Datalog API. It can return either page UIDs or
block UIDs. A returned block maps when it is a bare `geo:` block or has the
same supported location attributes as any other block source, so this contract
already accommodates block-level inputs without inventing synthetic pages.

Roam-specific `current/*` symbols are not supported in a fenced Datalog source.
Roam Map executes the copied query text through the frontend API rather than
inside a rendered native `:q` component, so those symbols do not have the
original block context. Until the explicit rejection tracked in
[issue #27](https://github.com/MaskyS/roam-map/issues/27) lands, authors must not
use contextual `current/*` symbols in map Datalog definitions.

Either dynamic definition can be reused with one exact, direct-child block
reference:

```text
{{map}}
  ((dynamic-definition-block-uid))
```

Only that leaf reference is treated as the source. Arbitrary referenced
outlines are not traversed. A bad or unavailable dynamic definition produces a
local diagnostic without suppressing valid direct sources or other dynamic
sources.

### Refresh behavior for dynamic membership

Edits inside the map definition and edits to an externally referenced dynamic
definition are watched. Once a page or block is a result, its location and
presentation attributes use the existing focused watches. A previously
unrelated entity can start matching a query without touching any known UID, so
no finite set of pull watches can discover every membership change. Use the
map's **Refresh** button to rerun membership in that case.

Both adapters query only the currently loaded Roam graph. They make no new
network request and do not write to query blocks, result entities, or location
pages. Saved `:q` components are not accepted in this first version because the
documented API executes Datalog text directly but does not document replaying a
saved `:q` component by UID. Search is not a planned adapter; native queries and
fenced Datalog cover the supported dynamic-membership cases.

## Map size: responsive by default, durable when resized

By default the map follows the width available in Roam, capped at 760 pixels,
with a responsive CSS height. Hover over the map to reveal the small grip just
outside its bottom-right corner, then drag it to resize either dimension. Roam Map
previews continuously, then writes the completed size once when the pointer or
keyboard gesture ends:

```text
{{map}}
  map/size:: 900 × 480
  [[Port Louis]]
```

Height accepts 220 through 1200 pixels and maximum width accepts 280 through
1600. A saved maximum width never exceeds the room Roam actually gives the
block. Use `auto` to leave one dimension responsive—for example,
`map/size:: auto × 480`. Deleting the size block restores both responsive
defaults. The grip also accepts the arrow keys in 20-pixel steps, or 100 pixels
while holding Shift: Up and Down adjust height, Left and Right adjust maximum
width.

This value belongs to the map definition block. If that definition is shown
by block reference in several places, the saved size is shared, while each
visible React and MapLibre instance still owns its own transient drag state and
resize observer. Roam Map does not use Roam's private image-size metadata and
does not save pan, zoom, bearing, or pitch as a side effect of resizing. Camera
state is deliberately transient; there is no **Save view** action or durable
camera schema.

## Feature data: what each source contributes

Roam Map resolves page and block data through the Roam Alpha API, never from
rendered query DOM. It accepts the current attribute representation, the
compatibility representation, and compatibility attributes beneath an exact
`roam/meta::` structural block.

The compiler-owned feature properties are:

| Property | Meaning |
| --- | --- |
| `roam/entityUid` | Stable page or block identity |
| `roam/identityKind` | `page` or `block` |
| `roam/title` | Full page title or source block text |
| `roam/label` | Readable leaf label for display |
| `roam/address` | Resolved `Address` value, when present |
| `roam/geocoderId` | Resolved `Geocoder ID`, when present |
| `roam/uncertaintyMeters` | `u` from the `Coordinates` URI, when present |
| `roam/sourceBlockUids` | Blocks that contributed this entity to the map |
| `roam/originBlockUids` | Source-origin provenance |

Suitable scalar attributes are also projected under their readable attribute
titles. For example, `Category:: Cafe` becomes a `Category` feature property
and can be read with the MapLibre expression `["get", "Category"]`.

The `roam/` prefix is reserved for compiler-owned properties. Source attributes
that collide with reserved names are diagnosed instead of silently renamed.

## Basemaps: names resolve to MapLibre styles

A basemap changes geographic context; it does not change map membership or
feature properties.

Save a per-map choice with a readable catalog name:

```text
{{map}}
  map/basemap:: OpenFreeMap Dark
  [[Port Louis]]
```

The toolbar selector previews another catalog entry without writing it to the
graph. Use `map/basemap` when the choice should remain visible and durable.

### Built-in catalog

| Name | Provider input | Credential |
| --- | --- | --- |
| `OpenFreeMap Liberty` | `https://tiles.openfreemap.org/styles/liberty` | None |
| `OpenFreeMap Positron` | `https://tiles.openfreemap.org/styles/positron` | None |
| `OpenFreeMap Bright` | `https://tiles.openfreemap.org/styles/bright` | None |
| `OpenFreeMap Dark` | `https://tiles.openfreemap.org/styles/dark` | None |
| `OpenFreeMap Fiord` | `https://tiles.openfreemap.org/styles/fiord` | None |
| `EOX Satellite Context` | Generated raster style using `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg` | None |

Compatibility names such as `streets`, `street`, and `liberty` resolve to
OpenFreeMap Liberty. `satellite` resolves to EOX Satellite Context.
[OpenFreeMap's current quick-start page](https://openfreemap.org/quick_start/)
is the provider reference for its built-in styles.

EOX is a 2016 Sentinel-2 global context mosaic with 10 m source resolution and
a useful zoom ceiling of 14. It is not current, building-level imagery. Its
generated style includes visible EOX, Copernicus, year, and license attribution.
The extension uses the 2016 endpoint, but provider terms can change independently
of the extension; check EOX's current [license summary](https://cloudless.eox.at/documentation/license)
and [service terms](https://cloudless.eox.at/pricing) for the intended use.

### Custom style URLs

A graph administrator can open **Settings → Roam Depot → Roam Map → Basemap
catalog** and choose **Complete MapLibre style URL**. Supply:

- a readable, graph-unique name;
- a complete HTTP(S) URL returning a MapLibre Style Specification; and
- optionally, a short usage or freshness notice shown above the map.

The remote style owns its sources, layers, sprites, glyphs, and attribution.
Its server and every referenced resource must permit browser requests from
Roam. The settings editor does not fetch or rewrite the style; MapLibre loads
the URL through its ordinary `Map#setStyle` boundary.

For example, the tested external demo entry uses:

```text
Name: MapLibre Demo
Format: Complete MapLibre style URL
Style URL: https://demotiles.maplibre.org/style.json
```

Then any map can select it without repeating the URL:

```text
map/basemap:: MapLibre Demo
```

See the complete [external style example](https://github.com/MaskyS/roam-map/blob/main/examples.md#external-maplibre-style-url).

### Custom raster tile templates

Choose **Raster tile template** when a provider supplies images rather than a
complete style. The editor accepts:

- an XYZ URL containing `{z}`, `{x}`, and `{y}`, or a WMS URL containing
  `{bbox-epsg-3857}`;
- mandatory visible attribution;
- `xyz` or `tms` tile scheme;
- 256 or 512 pixel tiles;
- minimum and maximum zoom from 0 through 24; and
- an optional map notice.

Roam Map turns that record into a small MapLibre Style Specification containing
one raster source and one raster layer. Attribution is passed to the source so
MapLibre displays it in the standard attribution control.

### Why `map/basemap` still contains a name

Do **not** put a URL directly in a map block:

```text
map/basemap:: https://example.com/style.json
```

`map/basemap` deliberately selects a catalog name. This keeps graph outlines
readable, lets many maps reuse one configuration, and avoids copying browser
keys into ordinary page content. An unknown name falls back visibly to
OpenFreeMap Liberty with a diagnostic. Renaming a custom catalog entry retains
its former name as an alias so existing maps continue resolving it.

Catalog settings are graph-synced. Collaborators may be able to read configured
URLs, and any embedded browser key necessarily appears in network requests.
Public catalog entries, map status, and diagnostics omit configured URLs; error
text redacts common key and token query parameters. These protections do not
turn browser credentials into secrets.

### Optional MapTiler shortcut

A graph administrator can open **Settings → Roam Depot → Roam Map → Basemap
catalog** and save one MapTiler public browser key. This convenience contributes:

```text
map/basemap:: MapTiler Satellite
map/basemap:: MapTiler Hybrid
```

The registry constructs MapTiler style URLs of this form internally:

```text
https://api.maptiler.com/maps/{style-id}/style.json?key={public-browser-key}
```

The key is stored once in Roam's graph-synced extension settings and is sent to
MapTiler in browser requests. Collaborators may be able to read it. Use a
[provider-restricted public browser key](https://docs.maptiler.com/cloud/api/authentication-key/),
not a secret, and check the [current plan terms](https://www.maptiler.com/cloud/pricing/).
The shortcut is optional. Other providers can use the general style-URL or
raster-template forms without receiving provider-specific code.

### Adding a basemap provider in the extension

For maintainers and coding agents, ordinary external providers need no adapter:
users add their style or tiles through the generic catalog. Add a provider
adapter only when it offers meaningful convenience such as turning one account
key into several named styles. Provider adapters belong in
`src/settings/basemap-registry.js`, not in source adapters or map views:

1. Normalize and validate the provider's graph-wide configuration.
2. Contribute one or more named catalog entries.
3. Let each entry build a MapLibre style URL or Style Specification.
4. Keep credentials out of public entries, feature properties, map blocks,
   status objects, and diagnostics.
5. Add the corresponding settings UI and honor `settings.canSet`.
6. Include complete, visible source attribution and provider notices.
7. Test configuration replacement, unknown schema preservation, key rotation,
   redaction, style replacement, and restoration of extension layers/images.

For a keyless built-in style, add a named entry with aliases, notice, and
`buildStyle`; the per-map Roam value still remains the readable name.

## MapLibre layers: how features are drawn

Roam Map owns one stable GeoJSON source named `roam-map-features`. A native
layer is a `MapLibre layer` descendant with exactly one ordinary code-block
child containing strict JSON. Unlike `Marker click`, it does not have to be a
direct child of the map:

````text
{{map}}
  [[Port Louis]]
  MapLibre layer
    ```json
    {
      "id": "places-by-category",
      "type": "circle",
      "source": "roam-map-features",
      "paint": {
        "circle-radius": 10,
        "circle-color": [
          "match",
          ["get", "Category"],
          "Cafe", "#d9822b",
          "#6f42c1"
        ]
      }
    }
    ```
````

Rules:

- The JSON must validate against the pinned MapLibre style specification.
- The layer must use `roam-map-features`; arbitrary authored sources are not
  accepted yet.
- Layer IDs must be unique. IDs beginning with `roam-map/` are reserved.
- Layers retain outline order.
- Authored layers add presentation over the compiled features; they do not
  change which sources belong to the map.
- MapLibre sizing depends on layer type: circles use pixel `circle-radius`,
  while symbols use multiplicative `icon-size`.

The default marker remains beneath authored layers so a malformed or missing
custom image does not make the underlying mapped place disappear. The reserved
selection ring remains above authored layers, but it is not an interactive
marker layer.

Use MapLibre's official [layer reference](https://maplibre.org/maplibre-style-spec/layers/)
for type-specific `layout` and `paint` properties and its
[expression reference](https://maplibre.org/maplibre-style-spec/expressions/)
for data-driven values such as `get`, `match`, `has`, and `coalesce`. Roam Map
validates authored JSON against the style specification pinned by this build.

### Reacting to the selected source

Roam Map publishes the selected entity UID to this map instance through MapLibre
global state under the exact key `roam-map/selected-entity-uid`. It is a transient
UI value: selecting a result or marker updates it, clearing the selection sets
it to `null`, and Roam Map restores it after a basemap style replacement. It is
never written to Roam and is isolated between duplicate rendered maps.

A custom layer can compare that value with the stable feature property
`roam/entityUid` using MapLibre's native [`global-state`
expression](https://maplibre.org/maplibre-style-spec/expressions/#global-state):

```json
{
  "id": "selected-place-emphasis",
  "type": "circle",
  "source": "roam-map-features",
  "filter": [
    "==",
    ["get", "roam/entityUid"],
    ["global-state", "roam-map/selected-entity-uid"]
  ],
  "paint": {
    "circle-radius": 18,
    "circle-color": "rgba(19, 124, 189, 0.14)",
    "circle-stroke-color": "#137cbd",
    "circle-stroke-width": 2
  }
}
```

The built-in subtle ring uses the same state. Do not treat the value as durable
map configuration or use it to rewrite source entities.

## Runtime images

Complete HTTP(S) image Markdown in a scalar attribute becomes an opaque runtime
image ID. The original URL is not exposed to MapLibre expressions.

Roam Map resolves Roam-hosted files through the supported file API, decodes and
center-crops each image to a consistent size, and registers:

- the square pixels under the base opaque ID; and
- alpha-clipped circular pixels under `<opaque-id>#circle`.

A symbol layer can select the circular form without another marker language:

```json
[
  "coalesce",
  ["image", ["concat", ["get", "Profile Picture"], "#circle"]],
  ["image", "roam-map/default-marker"]
]
```

Use a `has` filter before reading an optional image property. Keep an ordinary
point layer beneath image symbols as a visible fallback. Roam Map restores
registered images and authored layers after `Map#setStyle` replaces the style.

See [Circular image markers](https://github.com/MaskyS/roam-map/blob/main/examples.md#circular-image-markers)
for the complete tested outline.

## Marker interaction and reusable components

MapLibre layer JSON does not define arbitrary popup DOM or click effects. Put
one direct `Marker click` resource beneath the map instead:

````text
Marker click
  ```jsx
  function markerClick({ args }) {
    const context = JSON.parse(decodeURIComponent(args[1]));
    return <div>{context.feature.properties["roam/label"]}</div>;
  }
  ```
````

The child may instead be one exact block reference to reusable code:

```text
Marker click
  ((reusable-code-block-uid))
```

The URI-encoded, JSON-safe context contains:

| Field | Meaning |
| --- | --- |
| `version` | Context schema version |
| `mapUid` | Durable map definition UID |
| `clickId` | New identity for every physical click |
| `trigger` | `"marker"`; retained for compatibility, and produced only by an actual marker click |
| `entityUid` | The nearest marker's page or block UID |
| `identityKind` | `page` or `block` for the nearest marker |
| `entityUids` | Every distinct rendered hit, nearest first |
| `coincidentEntityUids` | Entities sharing the selected visible marker position |
| `feature` | Compiled feature for `entityUid` |
| `features` | Feature snapshots aligned with `entityUids` |
| `point` | Pixel position relative to the map canvas |
| `lngLat` | Geographic click position |
| `clientPoint` | Pixel position relative to the browser viewport |
| `modifiers` | Alt, Control, Meta, and Shift key state |

The stock fallback is built from the same components exported for JS/JSX code
at `window.RoamMap.components`. Check `window.RoamMap.version` before relying on
this API; the current version is `2`.

| Component | Purpose |
| --- | --- |
| `MarkerPopover` | Blueprint 3 popover anchored to the map point |
| `MarkerCard` | Selection, close, and right-sidebar controller with replaceable contents |
| `MarkerCardDetails` | Stock label and address body |
| `MarkerCardActions` | Stock **Open in sidebar** action and error feedback |
| `MapResultsPanel` | Live results list subscribed to one mounted map instance |
| `MapResultItem` | Accessible stock results row with replaceable contents |

`MarkerPopover` accepts these Roam Map props in addition to Blueprint 3
`Popover` props:

| Prop | Meaning |
| --- | --- |
| `context` | Marker-click context; `point` positions the synthetic popover target |
| `children` | A React node, or `({ close, isOpen }) => node` |
| `defaultIsOpen` | Initial visibility for uncontrolled use; defaults to `true` |
| `isOpen` | Optional controlled visibility |
| `onInteraction` | Called as `(nextIsOpen, event)` when visibility changes |
| `targetProps` | Props for the invisible one-pixel target; custom `style` is merged |

`MarkerCard` accepts these Roam Map props in addition to Blueprint 3 `Card`
props:

| Prop | Meaning |
| --- | --- |
| `context` | Marker-click context |
| `children` | A React node, or a render function receiving the card controller below |
| `initialEntityUid` | Initially selected coincident entity; defaults to `context.entityUid` |
| `onEntityChange` | Called as `({ entityUid, feature })` after a selector change |
| `onClose` | Optional close callback; without it, the card hides itself |
| `openEntityInSidebar` | Replaceable `(entityUid) => valueOrPromise` action |
| `showCloseButton` | Show the close button; defaults to `true` |
| `showEntitySelector` | Show a selector for truly coincident entities; defaults to `true` |
| `className`, `style` | Additional card presentation hooks |

The `MarkerCard` render function receives:

| Value | Meaning |
| --- | --- |
| `context` | Original click context |
| `entityUid`, `identityKind`, `feature` | Currently selected source identity and feature |
| `entityUids`, `features` | All rendered hits from the physical click |
| `coincidentEntityUids` | Entities at the selected visible marker position |
| `close()` | Close this card |
| `openInSidebar()` | Run the replaceable sidebar action; resolves to success or failure |
| `actionError` | Most recent sidebar-action error, if any |

Pass that render-function object to `MarkerCardDetails` and
`MarkerCardActions` with `{...card}` to reuse either stock section. This lets
custom code extend the stock card without copying its selection, close, and
sidebar behavior. A marker-click component can instead render unrelated UI,
create a portal, play a sound, show confetti, or return `null`.

Additional graph values such as `Image::`, `URL::`, or `Description::` should
be read through the Roam Alpha API using `entityUid`. Do not invent fixed popup
fields or pass internal asset records through the click context.

See the complete [custom effort popup](https://github.com/MaskyS/roam-map/blob/main/examples.md#custom-effort-popup).

## Results list: the sources behind the count

Clicking the place count in the map bar opens a results list above it: a
compact, text-first panel with one row per source entity in compiled outline
order. Each row shows the source label, the address when available, a clamped
`Description` value when the entity exposes one, and an **Open in sidebar**
action. Unmapped sources stay in the list with an `unmapped` tag. Richer
per-row explanations and source links are tracked in
[#18](https://github.com/MaskyS/roam-map/issues/18). The stock list
never loads images.

Selecting a row closes any open marker UI, highlights the place, and focuses it
without invoking `Marker click`. The camera zooms to at least level 15 but never
zooms out from a closer view. It measures the open list and toolbar and places
the point in the center of the map area they do not cover. Selecting a marker
highlights and scrolls its row into view while the list is open, and remains the
only action that opens the stock card or invokes user-authored marker code.

Replace the stock list with one direct `Results list` resource beneath the
map, exactly parallel to `Marker click`:

````text
Results list
  ```jsx
  function resultsList({ args }) {
    const context = JSON.parse(decodeURIComponent(args[1]));
    const { MapResultsPanel } = window.RoamMap.components;
    return <MapResultsPanel context={context} />;
  }
  ```
````

The child may instead be one exact block reference to reusable code. The
URI-encoded context is deliberately tiny — `{ version, mapUid, viewId }` —
because a results list is continuously live rather than a one-shot snapshot.
`MapResultsPanel` subscribes to the mounted map instance through a small
external store keyed by `viewId`, so main-window, sidebar, embed, and
block-reference instances stay isolated and the result set never serializes
into the component invocation.

`MapResultsPanel` accepts:

| Prop | Meaning |
| --- | --- |
| `context` | Decoded results-list context; supplies `viewId` |
| `viewId` | Direct store key; overrides `context.viewId` |
| `header` | Optional node rendered above the list |
| `renderItem` | `({ result, active, select, open, MapResultItem }) => node` row replacement |
| `className` | Additional panel class |

Each `result` row is
`{ entityUid, identityKind, title, label, address, description, mapped }`.
`select` selects, highlights, and focuses the marker without opening marker UI;
`open` opens the page or block in the right sidebar. Either is `null` when unavailable,
such as `select` on an unmapped row. `MapResultItem` renders one accessible row
and accepts `result`, `active`, `onSelect`, `onOpen`, and replaceable `children`.
A custom list can group, filter, re-rank, or replace rows through `renderItem`,
render an entirely different panel, or return `null`.

A custom list that wants images or other graph fields should read them through
the Roam Alpha API using each row's `entityUid`, just like custom marker cards.

## State, refresh, and cleanup

- Source and attribute changes use focused pull watches.
- The first non-empty result fits automatically; later refreshes preserve the
  user's viewport.
- Basemap toolbar changes are transient previews. Durable selection remains in
  `map/basemap`.
- Map selection and marker-click component mounts are per visible map instance.
- The same map rendered in the main window, right sidebar, or an embed must not
  share React roots, MapLibre objects, transient selection, or cleanup handles.
- Unmount and extension unload remove watches, observers, listeners, requests,
  runtime images, MapLibre maps, React roots, and nested Roam components.

## Where to make implementation changes

| Concern | Module boundary |
| --- | --- |
| Parse the map occurrence | `src/map/definition.js` |
| Compile direct source membership | `src/map/direct-sources.js` |
| Compile native-query and Datalog sources | `src/map/dynamic-sources.js` |
| Bound Roam query and Datalog API calls | `src/roam/api.js` |
| Resolve page and block locations and records | `src/map/place-records.js` |
| Project readable attributes | `src/roam/project-attributes.js` |
| Compile native layers | `src/map/layers.js` |
| Compile marker-click resources | `src/map/marker-click.js` |
| Join sources into the render plan | `src/map/compiler.js` |
| Validate custom URLs and build raster styles | `src/settings/custom-basemaps.js` |
| Persist and resolve the basemap catalog | `src/settings/basemap-registry.js` |
| Edit graph-wide basemap settings | `src/settings/basemap-settings.jsx` |
| Own MapLibre objects and resources | `src/maplibre/runtime.js` |
| Own the React map view | `src/ui/map-view.jsx` |
| Mount user marker components | `src/ui/roam-marker-click.jsx` |
| Parse `Results list` configuration | `src/map/results-list.js` |
| Mount user list components | `src/ui/roam-results-list.jsx` |
| Stock results panel and rows | `src/ui/results-list.jsx` |
| Per-view live results store | `src/ui/map-view-store.js` |
| Publish reusable components | `src/public-api.js` |

Before adding a new grammar, confirm that the behavior is not already an
ordinary MapLibre style, source, layer, expression, or Roam `roam/render`
capability. Prefer extending the typed boundary that owns the concept over
adding a parallel vocabulary.

## Further detail

- [Tested examples](https://github.com/MaskyS/roam-map/blob/main/examples.md)
- [Presentation and MapLibre contract](https://github.com/MaskyS/roam-map/blob/main/PRESENTATION.md)
- [Design notes](https://github.com/MaskyS/roam-map/blob/main/DESIGN.md)
- [Architecture and lifecycle](https://github.com/MaskyS/roam-map/blob/main/ARCHITECTURE.md)
- [Current issues](https://github.com/MaskyS/roam-map/issues)
