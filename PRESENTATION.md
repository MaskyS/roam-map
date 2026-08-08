# Roam attributes and MapLibre presentation

This document explains the boundary between Roam data and MapLibre
presentation. It covers the implemented direct-source checkpoint, the planned
query-source extension, and the verification work that keeps both paths
consistent. Read it before changing attribute projection, MapLibre
expressions, image markers, presets, or map-wide presentation options.

> Document role: this is the detailed presentation decision and experiment
> record. Historical prototype syntax is retained and labeled rather than
> erased. Current implementation claims were reconciled on 2026-08-08.

The central rule is:

> Roam Map translates Roam data into ordinary feature properties and MapLibre
> resources. After that translation, styling remains ordinary MapLibre.

The design deliberately does not introduce a second expression language.
When MapLibre already has a concept such as `get`, `case`, `coalesce`,
`interpolate`, a source, or a layer, Roam Map should use it directly.

## Status of the decisions

The current checkpoint compiles direct page sources into one stable GeoJSON
source, projects readable Roam attributes, registers image assets, and accepts
validated native MapLibre layers over that source. The earlier
`map/marker`, `map/color`, and `map/radius` circle path has been removed; its
findings remain documented below as history, not compatibility behavior. Native
query sources, global state, and a portrait preset remain future work.

| Area | Current direction | Status |
|---|---|---|
| Attribute authoring name | Attribute page title, such as `Profile Picture` | Implemented |
| Attribute identity while reading Roam | Attribute page UID | Implemented internal detail |
| Feature-property layout | Flat title-keyed attributes; `roam/` reserved for compiler fields | Implemented |
| Initial projection breadth | Project suitable scalar attributes, then measure | Implemented; measurement still required |
| Native query source | Normalize results to explicit page or block subjects | Not implemented |
| Cross-source identity | Deduplicate canonical features; retain memberships and provenance | Direct sources implemented; query memberships pending |
| Per-feature presentation | Native MapLibre expressions | Implemented over the compiled source |
| Map-wide presentation values | MapLibre `global-state` | Not implemented |
| Per-map basemap selection | Readable catalog name through `map/basemap` | Implemented |
| Graph-wide basemap providers | Versioned provider-keyed `extensionAPI.settings` value | Implemented for MapTiler; ready for different provider adapters |
| Keyless satellite context | EOxCloudless 2016 native raster style | Implemented; service terms still require an honest notice |
| BYOK satellite and hybrid | MapTiler `satellite-v4` and `hybrid-v4` style URLs | Implemented; live key/account verification required |
| Images | Runtime asset manager plus MapLibre style images | Implemented for exact HTTP(S) image Markdown |
| Registered asset size | 64×64 physical pixels at `pixelRatio: 2` | Implemented |
| Image crop variants | Square token plus an alpha-clipped `#circle` variant | Implemented |
| Historical marker/color/radius spike | Use native layers instead | Removed after validating the underlying attribute and watch behavior |
| Easy portrait markers | First-party preset compiled to native layers | Not implemented |
| External JavaScript hook | Keep the seam possible; do not publish it yet | Deferred |

Future work must not describe a target form in this document as implemented
until the code, focused tests, `npm run check`, and the live Roam seam all
verify it.

## The prerequisite models

### A Roam attribute is a relationship

Consider a person page with this visible attribute:

```text
Profile Picture:: ![](https://example.com/andy.jpg)
```

There are three different things here:

- the entity being described, such as `[[People]]/Andy Matuschak`;
- the attribute page, `[[Profile Picture]]`; and
- the attribute value, the image Markdown.

In Roam's current HARC representation, those roles are represented by the
relationship's `:harc/e`, `:harc/a`, and `:harc/v` respectively. The entity
pull normally sees the relationships through reverse `:harc/_e`. The HARC
relationship can also retain source provenance through `:harc/a-source` and
`:harc/v-source`.

See Roam's [current attributes data
model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new)
for the exact representation. Roam Map also reads the [compatibility
attributes data
model](https://roamdocs.fyi/developer-documentation/attributes-data-model),
which represents attributes through `:entity/attrs` and `:attrs/lookup`.

The authored name in this example is the title of the **attribute page**:
`Profile Picture`. It is not the person page title, the image URL, or an
extension-generated key.

### UIDs and titles solve different problems

Roam page titles are unique within one graph and are the readable, portable
authoring surface. UIDs are stable entity identities inside that graph. Roam's
[data model](https://roamdocs.fyi/developer-documentation/data-model) explains
the page/block entities, UIDs, references, pulls, and queries.

Roam Map should therefore use them differently:

```text
user writes and reads       Profile Picture
compiler resolves internally attribute-page-uid
compiler watches internally  attribute-page-uid and source page UID
MapLibre feature property    Profile Picture
```

The internal UID lets the compiler read the right HARC relationship and retain
provenance. It should not make the user author this:

```json
["get", "roam:attr:xK9dPq2Lm"]
```

That expression is unreadable without another inspection tool and cannot be
copied to a different graph, where the corresponding attribute page has a
different UID. If `[[Profile Picture]]` is renamed, title-authored
configuration can fail visibly with a local diagnostic; a UID-authored layer
would continue through an opaque identifier.

### A GeoJSON feature separates geometry and properties

Roam Map compiles page-backed inputs to GeoJSON features. In simplified form:

```js
{
  type: "Feature",
  geometry: {
    type: "Point",
    coordinates: [-118.2437, 34.0522]
  },
  properties: {
    "Profile Picture": "roam-map:image:abc123",
    "Birthday": "1940-05-17",
    "roam/pageUid": "the-person-page-uid",
    "roam/title": "People/Alan Kay"
  }
}
```

MapLibre does not know that `Profile Picture` came from a Roam attribute. It
only sees a feature property. That is a useful boundary: MapLibre can style the
same property without learning Roam's HARC or compatibility models.

The [GeoJSON
specification](https://datatracker.ietf.org/doc/html/rfc7946) defines features,
geometry, and properties. The MapLibre style specification separates [data
sources](https://maplibre.org/maplibre-style-spec/sources/) from the
[layers](https://maplibre.org/maplibre-style-spec/layers/) that present them.

## Marker-click behavior is user code, not layer JSON

MapLibre's documented layer-click example listens for `click`, reads the
clicked feature, and creates popup content in application code. Neither its
layer specification nor its expression language describes arbitrary popup DOM.
Roam Map therefore does not overload `MapLibre layer` or introduce a list of
special popup fields or actions.

One direct `Marker click` block may instead contain arbitrary JavaScript, JSX,
or Clojure accepted by Roam's `roam/render`, or reference reusable code
elsewhere. At click time Roam Map supplies a URI-encoded, versioned JSON
snapshot:

```js
{
  version: 1,
  mapUid,
  clickId,  // increments for every click, including the same marker twice
  pageUid,  // the marker nearest the click
  pageUids, // every distinct rendered hit, nearest first
  coincidentPageUids, // pages sharing the selected visible marker position
  feature,  // the feature for pageUid
  features, // compiled GeoJSON snapshots in the same order as pageUids
  point,    // {x, y} relative to the map canvas
  lngLat,   // {lng, lat}
  clientPoint, // {x, y} relative to the browser viewport
  modifiers   // altKey, ctrlKey, metaKey, shiftKey
}
```

The component can lay out any React/JSX UI, create a portal, query graph data
such as `Image::` through the Alpha API, call other supported libraries, or run
an effect and return `null`. With `Marker click` present, the extension adds no
card, close control, coincident selector, or page action. Without it, the stock
Blueprint popover and card provide selection and **Open in sidebar**. When two
marker circles merely overlap, the nearest center wins and no chooser appears.
The chooser remains for pages whose marker centers coincide within one screen
pixel.

Every user click creates a new `clickId` and therefore a fresh component mount;
clicking the same marker twice can play an effect twice. The event context and
selected feature data are snapshots, so an unrelated graph refresh cannot
replay a sound or animation. One map-level listener queries every interactive
layer together, preventing one physical click from firing once per overlapping
MapLibre layer.

This path deliberately uses Roam's existing arbitrary-code permission model.
The extension passes a generated `{{roam/render: ...}}` string to the documented
`roamAlphaAPI.ui.components.renderString` API and symmetrically calls
`unmountNode`; it neither evaluates code itself nor writes transient selection
state into the graph. Treat a map containing a Marker click component exactly
as any other graph content containing `roam/render` code.

Roam's current extension API does not register components for `roam/render`.
Roam Map instead publishes a small versioned JS/JSX API at
`window.RoamMap.components`: `MarkerPopover`, `MarkerCard`,
`MarkerCardDetails`, and `MarkerCardActions`. The stock fallback uses those same
components. `MarkerCard` exposes the active page and feature, close and sidebar
actions, and action state to a render-function child, so a graph author can
reuse, extend, or replace its interior without copying the controller logic.
`MarkerPopover` forwards Blueprint 3 Popover props and exposes its close state
to a function child. The namespace is installed and removed with the extension.

Image Markdown remains an opaque runtime ID in feature properties, preserving
the MapLibre expression and asset boundary. Roam-backed component code should
use `pageUid` and the Alpha API to read the original `Image::` value. That keeps
graph reads in user code instead of exposing the map's internal asset records
as a click-component API.

## Sources determine membership, not presentation

A page can enter a map through a direct child page reference, a reusable
outline, a native `{{query}}`, search, `:q`, or another source adapter. That
upstream difference must not change the page's downstream feature schema.

The general pipeline is:

```text
map definition
  -> source adapters
  -> raw source results
  -> explicit result normalization
  -> canonical subjects
  -> geometry and attribute resolution
  -> feature properties and asset descriptors
  -> native MapLibre layers
```

In particular:

> The source determines which subjects are members of the map. The resolved
> subject determines intrinsic geometry and attributes. MapLibre determines
> presentation.

This means a direct reference to Alan Kay and a query result normalized to
Alan Kay's page UID must produce the same `Profile Picture` property and use
the same `get` expression.

### Map A: person pages entered directly beneath the map

This implemented example has unambiguous page-backed inputs:

````text
{{map}}
  [[People]]/Andy Matuschak
  [[People]]/Bret Victor
  [[People]]/Alan Kay
  MapLibre layer
    ```json
    {
      "id": "people-base",
      "type": "circle",
      "source": "roam-map-features",
      "paint": {
        "circle-radius": 12,
        "circle-color": "#6f42c1",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    }
    ```
  MapLibre layer
    ```json
    {
      "id": "people-portraits",
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

The direct-source adapter emits three page inputs. Each page UID is its subject
identity. The page resolver then reads location and other attributes, including
`Profile Picture`. The two native layers consume the resulting features.

`MapLibre layer` is a readable parent block with exactly one ordinary
code-block child containing strict JSON. Roam may render that child with its
generic `javascript` label; its contents remain JSON. This is the only accepted
form because Roam can normalize an unknown custom code-fence language. The
earlier compact `maplibre-layer` fence was removed: accepting it only when its
literal block string happened to survive Roam created an unreliable second
grammar. Its rejection is a compatibility decision, not missing parser work.

The direct sources, `roam-map-features` source ID, title-keyed attribute
projection, runtime image registration, and validated layers in Map A are all
implemented in the current checkpoint.

### Map B: the same presentation over people returned by a query

The layer definitions do not change when membership comes from a native query.
The query adapter in this example is the next checkpoint; it does not execute
yet:

````text
{{map}}
  People with locations
    {{query: {and: [[People]] [[Location]]}}}
  MapLibre layer
    ```json
    {
      "id": "people-base",
      "type": "circle",
      "source": "roam-map-features",
      "paint": {
        "circle-radius": 12,
        "circle-color": "#6f42c1",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    }
    ```
  MapLibre layer
    ```json
    {
      "id": "people-portraits",
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

The query predicate is illustrative; its exact behavior with the graph's
current People and location conventions must be verified in Roam. The
important point is that the query source produces membership candidates. It
does not need to return `Profile Picture` or any other presentation attribute.

Roam Map runs an existing query block through the documented
[`roamAlphaAPI.data.roamQuery`](https://roamdocs.fyi/developer-documentation/roam-alpha-api)
API. That API returns `{total, results}` containing pulled matching blocks or
pages. It defaults to 20 results unless the caller supplies another limit, so
the map must set an explicit cap or request all results and must report visible
truncation.

Each result is then normalized to a subject. Once a result becomes a person
page UID, the same page resolver and attribute projector used by Map A run:

```text
query result
  -> person page UID
  -> resolve location
  -> project Profile Picture
  -> resolve and register image asset
  -> feature.properties["Profile Picture"]
  -> ["get", "Profile Picture"]
```

The [Query](https://roamdocs.fyi/help/query) documentation matters here because
native queries match blocks or pages and nested blocks inherit references from
their parents and owning page. A result block is therefore not automatically
the person, place, or other entity the map should display.

### Query result normalization must be explicit

A query source needs an explicit result mode when its results are blocks:

| Mode | Meaning |
|---|---|
| `pages` | Accept page results and diagnose blocks |
| `owner-page` | A result block contributes the page on which it lives |
| `referenced-pages` | A result block contributes its directly referenced pages |
| `result-block` | The result block itself is the mapped subject |
| `owner-and-references` | Contribute both, only when the user explicitly asks for it |

The exact readable Roam spelling for this source option remains a product
experiment. It must not be inferred from the query title or from whichever
candidate happens to have valid coordinates.

For a query whose matching blocks live on person pages, `owner-page` is the
likely contract. If `roamQuery` returns the person pages themselves, `pages` is
enough. A block on a located page that also references another located page is
ambiguous unless the source declares its mode.

Stored query settings such as **Group by Page** and **Nest under parent
results** may shape, collapse, or order the raw results when UID mode uses
them. They must not implicitly choose `owner-page` versus `referenced-pages`;
the map's explicit result-normalization rule controls that semantic step.
Roam's [Query
Builder](https://roamdocs.fyi/help/roam-query-builder) edits the real query
syntax, making the query block a reusable source definition rather than a DOM
surface for Roam Map to scrape.

### Contributions preserve source context before features deduplicate

A raw query result should first become a source contribution:

```js
{
  sourceId: "people-with-locations",
  group: "People with locations",
  resultEntity: {kind: "block", uid: "result-block-uid"},
  subject: {kind: "page", uid: "person-page-uid"},
  normalizationMode: "owner-page",
  order: 7
}
```

Contributions from direct refs, queries, and reusable collections then converge
on canonical features. If the same person is a direct child and also appears in
one or more queries, Roam Map should retain one page-identified feature plus
all memberships and provenance:

```js
properties: {
  "Profile Picture": "roam-map:image:abc123",
  "roam/pageUid": "person-page-uid",
  "roam/groups": ["People with locations", "VIPs"]
}
```

A native layer can target a logical query or outline group while continuing to
use ordinary page attributes:

```json
{
  "filter": [
    "all",
    ["in", "People with locations", ["get", "roam/groups"]],
    ["has", "Profile Picture"]
  ],
  "layout": {
    "icon-image": [
      "coalesce",
      ["image", ["concat", ["get", "Profile Picture"], "#circle"]],
      ["image", "roam-map/default-marker"]
    ]
  }
}
```

Removing one contribution must not remove the feature while another source
still contributes it. Query result order is presentation/provenance, never
identity.

### Page attributes and result-block attributes are different scopes

Suppose a query returns this block:

```text
Met [[Alice]] in [[Paris]]
  Date:: 2026-08-07
  Importance:: high
```

If the source maps the block's owning person page, `Profile Picture` and other
person attributes come from that page. `Date` and `Importance` belong to this
specific result contribution; they must not silently overwrite intrinsic page
properties. If several result blocks target the same page, those values need an
explicit aggregation rule or the blocks must remain separate block-identified
features.

This distinction generalizes beyond people:

- Page-backed features project attributes from the resolved page.
- Block-backed features may project attributes from the resolved block.
- External GeoJSON features retain their own source properties.
- Query-result or relationship data stays on the contribution until an
  explicit rule promotes or aggregates it.

### Query membership and feature data invalidate separately

There are three independent update paths:

| Change | Work required |
|---|---|
| Query definition or membership | Rerun the query and diff contributions |
| Location or attribute on an existing subject | Reresolve that subject and update its feature/assets |
| Layer, preset, or map-wide option | Update MapLibre presentation without rerunning the query |

Editing an existing person's `Profile Picture` should not rerun the query. It
should update the page feature and image asset. Adding a new person who now
matches the query does require a new query result set.

The documented native query is not reactive by default; the user can refresh
it or enable its native **Reactive** option. The Alpha API documents a one-shot
`roamQuery` call but no query-result subscription. Pull watches can observe the
query definition and already-known result pages, but cannot discover a new
matching page. The honest initial map behavior is therefore run-on-mount,
rerun-on-definition-change, an explicit Refresh action, visible truncation,
and cancellation/generation guards. Roam Map must not scrape rendered query
results to simulate a subscription.

## Why the expression is `get`

MapLibre style values can be literals or expressions. A literal gives every
feature the same value:

```json
"circle-color": "#6f42c1"
```

An expression is a JSON array whose first item names a MapLibre expression
operator:

```json
"circle-color": ["get", "Color"]
```

`get` is MapLibre's standard operator for reading a property. Its common
one-argument form reads from the current feature's `properties` object:

```json
["get", "Profile Picture"]
```

For each feature, that means approximately:

```js
feature.properties["Profile Picture"]
```

The exact semantics, including the two-argument form that reads from another
object, are in the MapLibre [`get` expression
reference](https://maplibre.org/maplibre-style-spec/expressions/#get).

`get` is not a Roam query and does not read the graph. Roam Map has already
done the graph read and produced the feature by the time MapLibre evaluates the
expression.

### Why not `roam-attr(Profile Picture)`?

Neither of these is a MapLibre expression:

```text
roam-attr(Profile Picture)
```

```json
["roam-attr", "Profile Picture"]
```

Supporting either form would require Roam Map to invent a parser or expression
operator, transform it into MapLibre, reproduce MapLibre's type and error
rules, and document the interaction with every other expression. The same
work is already expressed by projecting the attribute once and using native
`get`.

### Why not `get` plus an extension prefix?

This is valid MapLibre but needlessly indirect for authored attributes:

```json
["get", "roam/attr/Profile Picture"]
```

The attribute page title is already unique within the graph and portable
between graphs. Roam Map should reserve the `roam/` prefix for values it owns,
such as `roam/pageUid`, `roam/title`, and provenance fields. If a graph really
contains an attribute page whose title conflicts with that reserved prefix,
the compiler should report a diagnostic rather than silently rename it.

## The feature-property contract

The current projector exposes suitable scalar attributes as flat properties
keyed by attribute page title. Flat properties keep the ordinary MapLibre
expression short:

```json
["get", "Profile Picture"]
```

Nesting attributes inside another object is possible because `get` has an
object form, but it makes every expression longer:

```json
["get", "Profile Picture", ["get", "attributes"]]
```

The flat form is the implemented contract for this checkpoint.
Compiler-owned properties use the reserved `roam/` prefix to avoid ordinary
collisions.

Three related namespaces appear in this design and must stay distinct:

- feature-property keys owned by the compiler use the `roam/` prefix, such as
  `roam/pageUid`;
- documented built-in style images use the `roam-map/` prefix, such as
  `roam-map/default-marker`, because style image IDs share MapLibre's image
  namespace with sprite entries, not with attribute titles; and
- minted per-asset tokens use the `roam-map:image:` scheme so an opaque
  generated ID cannot be mistaken for a documented built-in.

Use these exact spellings everywhere; do not coin additional prefixes.

The projector applies these tested value rules:

- An absent attribute means the property is absent, so
  `["has", "Attribute"]` is false.
- One text, number, boolean, or page-reference value becomes a scalar. A page
  reference becomes its readable page title.
- Multiple distinct values become an array in deterministic relationship
  order. A preset that needs one value must select one explicitly.
- Unsupported values are omitted and produce a local diagnostic; they are not
  silently stringified into plausible-looking style input.
- Image Markdown is the one deliberate exception to value-preserving
  projection: the projected value is a minted asset token, not the authored
  URL or Markdown. An expression that compares `Profile Picture` against the
  authored URL therefore will not match. The current contract does not expose
  the raw URL under a companion property. The pipeline is described below.

MapLibre expressions are typed. A feature that supplies a number on one page
and a nonnumeric string on another can cause property-level evaluation errors.
The compiler should surface predictable conversion problems in Roam rather
than relying on a browser-console warning.

### Project all or only demanded attributes?

There are two legitimate implementation strategies:

1. Project all suitable scalar attributes already pulled for each resolved
   page.
2. Walk the active layers and project only statically requested attributes.

Project-all supports dynamic keys, makes inspection complete, and avoids
turning expression dependency analysis into a prerequisite. The current HARC
place pull already retrieves the page's attribute relationships, so selective
projection does not yet automatically produce narrower graph reads or watches.

Demand-driven projection reduces GeoJSON size and can make missing-property
diagnostics natural, but it must correctly understand `get`, `has`, object
access, dynamic keys, filters, and future expression forms. A static expression
walk is valuable for diagnostics even if projection remains broad.

The checkpoint implements project-all for suitable scalar attributes. Before
freezing that breadth as a permanent public guarantee, measure the serialized
feature collection and update behavior on both the nine-person fixture and a
larger fixture. Projected attributes stay inside the browser, but they are
still copied into the MapLibre runtime and worker, which matters for large or
sensitive records.

## Three scopes of presentation value

The design needs to distinguish three scopes without inventing one union type
for every style property.

### A literal is the same for every feature

```json
"circle-radius": 10
```

### `get` reads a value from each feature

```json
"circle-radius": ["get", "Marker Radius"]
```

### `global-state` reads one map-wide value

MapLibre GL JS provides a native [`global-state`
expression](https://maplibre.org/maplibre-style-spec/expressions/#global-state).
The style can declare defaults in its root [`state`
property](https://maplibre.org/maplibre-style-spec/root/#state), and the runtime
can update a value through
[`map.setGlobalStateProperty`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setglobalstateproperty).

This lets a readable Roam option feed a native MapLibre expression:

```text
Options
  Map/Marker color:: #6f42c1
```

```json
"circle-color": [
  "coalesce",
  ["get", "Color"],
  ["global-state", "roam/marker-color"]
]
```

The feature's `Color` attribute wins when present. Otherwise, the map-wide
value is used. `coalesce` is the native MapLibre operator for the first usable
value; see its [`coalesce`
reference](https://maplibre.org/maplibre-style-spec/expressions/#coalesce).

MapLibre GL JS added global style state in version 5.6. Roam Map currently pins
5.24.0, so it is available in the chosen browser renderer. It is not currently
implemented in MapLibre Native, which should be recorded if the rendering
target ever changes.

Roam Map must validate values before calling the API, namespace its keys under
`roam/`, and restore its global-state values after a style replacement. Global
state is a bridge into layer expressions, not a second application-state store.

## Images are data plus runtime resources

A Roam image commonly appears as Markdown:

```text
![](https://example.com/portrait.jpg)
```

Roam supports external images and uploaded files; see Roam's [image
documentation](https://roamdocs.fyi/help/images). The supported
[`roamAlphaAPI.file` APIs](https://roamdocs.fyi/developer-documentation/roam-alpha-api)
matter because encrypted-graph files cannot be treated as ordinary public
URLs.

MapLibre's `icon-image` does not consume image Markdown or a URL directly. It
consumes the name of an image available in the current style. The runtime
registers `ImageData` through
[`map.addImage`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#addimage);
see MapLibre's [add-an-icon
example](https://maplibre.org/maplibre-gl-js/docs/examples/add-an-icon-to-the-map/)
and the symbol layer's [`icon-image`
property](https://maplibre.org/maplibre-style-spec/layers/#layout-symbol-icon-image).

The implemented pipeline is:

```text
Roam attribute value
  -> parse exact HTTP(S) image Markdown
  -> resolve Roam-hosted files through the supported Roam file API
  -> load and decode
  -> center-crop and resize to 64 by 64 physical pixels
  -> derive an alpha-clipped circular variant
  -> deduplicate
  -> mint an opaque asset ID
  -> put that ID in feature.properties["Profile Picture"]
  -> register the square ID and its #circle variant at pixelRatio 2
```

The user writes `Profile Picture`; the minted value is an internal runtime
resource name that the user does not need to discover.

The asset manager now:

- cancel stale loads when compilation changes or a map unmounts;
- deduplicate the same source image;
- preserve the square image and derive a `<token>#circle` alpha-clipped variant;
- register every minted asset at a documented canonical pixel size and
  `pixelRatio`, so `icon-size` has one predictable meaning instead of varying
  with each upload's intrinsic dimensions;
- register required images before the portrait layer is expected to render;
- restore runtime images after `map.setStyle` replaces the style;
- retain a guaranteed registered fallback image; and
- report malformed, inaccessible, or unsupported images locally.

The runtime deliberately does not rely on MapLibre's
[`styleimagemissing`](https://maplibre.org/maplibre-gl-js/docs/examples/generate-and-add-a-missing-icon-to-the-map/)
event as its primary loading path. Encrypted-graph files must be resolved
through the supported Roam file API rather than a fetchable URL. More subtly,
the fallback `image` inside `coalesce` can satisfy `icon-image`, so the event
need not fire for the missing portrait. That behavior was verified against the
pinned MapLibre GL JS 5.24.0 runtime. Registering required images before adding
the portrait layer also avoids a fallback-first flicker.

### A robust portrait layer

The implemented native portrait example uses ordinary MapLibre layers over the
same GeoJSON source. A future portrait preset should compile to these same
resources.

First, a circle layer keeps every mapped person visible:

```json
{
  "id": "people-base",
  "type": "circle",
  "source": "roam-map-features",
  "paint": {
    "circle-radius": 12,
    "circle-color": "#6f42c1",
    "circle-stroke-color": "#ffffff",
    "circle-stroke-width": 2
  }
}
```

Then a symbol layer presents features with an image token:

```json
{
  "id": "people-portraits",
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

The `has` filter prevents a missing property from being passed to `image`,
which requires a string. The [`image`
expression](https://maplibre.org/maplibre-style-spec/expressions/#image)
checks whether an image name is available in the style. `coalesce` supplies the
registered fallback when the requested asset is unavailable. MapLibre's
[fallback image
example](https://maplibre.org/maplibre-gl-js/docs/examples/use-a-fallback-image/)
demonstrates this pattern.

`"icon-size": 1` produces a 32 CSS-pixel marker because minted assets are 64
by 64 physical pixels registered at `pixelRatio: 2`. Without that
normalization the multiplier would vary with each upload's intrinsic
dimensions, and no single value could produce uniform markers.

The underlying circle remains important. A MapLibre expression error returns
the affected style property's default; it does not remove the GeoJSON feature,
but the default for `icon-image` is no icon. Preserving the feature in data is
not the same as keeping a visible marker.

MapLibre cannot crop an arbitrary photograph into a circle through a symbol
style property. Roam Map therefore preprocesses the pixels. It registers the
center-cropped square under the feature's opaque token and an alpha-clipped
copy under `<token>#circle`. The layer chooses the circular registration with
native `concat`; an advanced layer can keep using the base token to request the
square image. The feature property remains the base token, so presentation
does not leak back into Roam attribute projection.

This follows MapLibre's own [generated missing-image
example](https://maplibre.org/maplibre-gl-js/docs/examples/add-image-missing-generated/),
which creates RGBA image data at runtime and uses `concat` to select derived
image IDs. Roam Map's extra work is the Canvas alpha clip performed before
registration.

MapLibre's [Add custom icons with Markers
example](https://maplibre.org/maplibre-gl-js/docs/examples/add-custom-icons-with-markers/)
takes another valid route: it creates one DOM element per feature, applies
`border-radius: 50%`, and passes that element to `new Marker(...)`. That route
is attractive when a map needs rich HTML or marker-specific DOM interactions.

It is not interchangeable with a native symbol layer. Making HTML markers the
default would give Roam Map a second renderer and lifecycle, and those markers
would not participate in MapLibre layer expressions, filters, ordering,
collision handling, or batching. Preprocessed style images therefore remain
the default for this checkpoint. They keep direct and future query-fed People
maps on the same native layer path and survive style replacement through the
existing asset manager. HTML markers can remain an explicit future option for
maps whose requirements genuinely call for DOM content.

### Expression edge cases worth testing

The first two behaviors below were verified by evaluating the expressions
with `createExpression` from the installed
`@maplibre/maplibre-gl-style-spec`; repeat that check when the pin changes.

- `concat` converts `null` to an empty string. Concatenating a missing
  `Profile Picture` with a `#circle` suffix evaluates to the junk image name
  `"#circle"` rather than selecting a fallback.
- `coalesce` handles unavailable `image` results: with the property present
  but the image unregistered, the fallback image is selected. It cannot catch
  the type error produced by passing an absent property to `image`: the whole
  `coalesce` evaluates to `null` after a logged error, the fallback is not
  selected, and `icon-image` falls back to no icon. The `has` filter is
  therefore required, not merely defensive.
- `to-number` accepts multiple candidate arguments. A robust expression can
  provide an explicit fallback:

  ```json
  ["to-number", ["get", "Population"], 0]
  ```

  A value such as `1,000,000` is not directly converted by JavaScript's
  numeric coercion. Roam Map should diagnose known conversion problems rather
  than depend on MapLibre's console warning and property default. See the
  [`to-number`
  reference](https://maplibre.org/maplibre-style-spec/expressions/#to-number).

## Presets should be thin and ejectable

The easy path may be a first-party portrait-marker preset that asks the user
for an actual `[[Profile Picture]]` page reference. The exact Roam outline
spelling remains a live product experiment. Discovery follows the project's
existing rule that a slash command inserts canonical forms rather than
introducing a second editor: both the preset outline and an ejected native
layer block should be insertable from a slash command or picker.

The preset must compile to the same feature properties, asset records, and
native MapLibre layers described above. It must not create a parallel marker
language. An advanced user should be able to inspect or copy the generated
layer specifications and continue with ordinary MapLibre.

That gives the product two compatible paths:

```text
easy:     portrait preset + [[Profile Picture]]
advanced: native MapLibre layer + ["get", "Profile Picture"]
```

## Coincident features remain distinct

Page UID is the identity of a page-backed feature. Coordinate equality is not
identity. In the current people fixture, Alan Kay and Anthony Padilla share the
same Los Angeles coordinates and must remain two features.

`"icon-overlap": "always"` allows symbols to overlap; it does not move two
symbols at the same coordinate apart. One can still paint exactly over the
other. A first-party solution must make both discoverable through a stack
badge, click-to-cycle behavior, a deterministic radial offset, spiderfying, or
another explicit interaction. This is product behavior, not evidence for a
general JavaScript plugin API.

## Basemaps are named graph capabilities

A basemap changes geographic context, not map membership. A direct-source map
and a future query-source map can therefore make the same durable selection:

```text
map/basemap:: MapTiler Hybrid
```

The source path does not see that value:

```text
direct references or query results
  -> canonical features and attributes
  -> roam-map-features

map/basemap name
  -> graph basemap catalog
  -> provider adapter
  -> MapLibre style URL or StyleSpecification
  -> Map#setStyle
  -> restore roam-map-features, layers, and images after style.load
```

This separation matters for the People fixture. Switching among OpenFreeMap
styles, EOX, and MapTiler must not rerun a People query, change the projected
`Profile Picture` property, or introduce a provider-specific source adapter.
It replaces the base style, then restores the same source, portrait layers,
square and circular image registrations, and click handlers.

### What a user configures

The built-in catalog entries are:

| Name | Provider result | Account required |
|---|---|---|
| `OpenFreeMap Liberty` | Liberty style URL | No |
| `OpenFreeMap Positron` | Positron style URL | No |
| `OpenFreeMap Bright` | Bright style URL | No |
| `OpenFreeMap Dark` | Dark style URL | No |
| `OpenFreeMap Fiord` | Fiord style URL | No |
| `EOX Satellite Context` | Native raster style using EOxCloudless 2016 | No |

The unprefixed OpenFreeMap style names also resolve. The compatibility value
`streets` resolves to OpenFreeMap Liberty. The compatibility value `satellite`
resolves to EOX Satellite Context, not to an unnamed current commercial imagery
service.

OpenFreeMap's website labels one demonstration `3D`, but it loads Liberty and
changes the camera pitch, bearing, zoom, and rotation behavior. It is therefore
not a sixth basemap. When Roam Map exposes those controls, 3D belongs to view
configuration so that it can compose with any suitable style.

Roam's [Depot Extension
API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api)
documents settings as graph-synced, JSON-serializable extension state. The Roam
Map settings panel uses that surface for a versioned object keyed by provider.
Conceptually:

```json
{
  "version": 1,
  "providers": {
    "maptiler": { "apiKey": "public-browser-key" }
  }
}
```

The one graph-wide MapTiler configuration contributes two choices:

```text
MapTiler Satellite
MapTiler Hybrid
```

They resolve to MapTiler's `satellite-v4` and `hybrid-v4` style URLs. This is
why the user supplies an account once rather than pasting authenticated URLs
under every map. Different maps can select Satellite or Hybrid from that same
provider. If Roam Map later supports Mapbox, Esri, or another provider, each
gets a distinct provider record and distinct catalog names. Those different
providers can coexist. Multiple arbitrary accounts for one provider are not
part of the ordinary model.

The map toolbar's selector is deliberately a preview. It lets someone compare
views without writing to the graph. The outline's `map/basemap` value remains
the saved choice because it is visible, referenceable, and exportable.

### Why the key is not a map attribute

A MapTiler browser key is client-visible by design. Putting it in a password
input only prevents casual shoulder-surfing; it does not make the value a
secret. Roam settings sync it with the graph, collaborators may be able to
inspect it, and MapLibre sends it with provider requests. Use MapTiler's
[public-key protection](https://docs.maptiler.com/cloud/api/authentication-key/)
and check the account's current permitted uses and request allowance.

The boundary is still useful:

- the key is stored once in that provider's graph configuration;
- map blocks contain only a readable catalog name;
- feature properties and source provenance never contain the key;
- public catalog entries and React status omit the style URL and fingerprint;
- map errors redact `key`, `token`, and `access_token` query values; and
- changing a key changes the internal fingerprint, so mounted maps reload the
  same named style without requiring edits to every map.

### Why EOX is called context

The keyless entry uses this exact Web Mercator tile template:

```text
https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg
```

It is the 2016 Sentinel-2 cloudless mosaic at roughly 10 m resolution. Roam Map
requests tiles through zoom 14 and lets MapLibre overscale them above that.
This can show regions, roads, fields, and settlement patterns, but it is not a
current building-level satellite view. The style's attribution identifies EOX,
Copernicus, 2016, and CC BY 4.0. EOX's free-service terms and rate limits still
need checking for the intended use, so the UI states that caveat instead of
calling the service unrestricted.

This is an ordinary MapLibre [raster
source](https://maplibre.org/maplibre-style-spec/sources/#raster) and raster
layer. MapTiler is an ordinary complete style URL. The catalog adds naming,
provider setup, and key hygiene around those native inputs; it does not add a
replacement style language.

## The JavaScript customization hook remains deferred

Validated GeoJSON, native MapLibre layers, native expressions, and runtime
images already provide a useful customization surface without executing
arbitrary graph code. Planned global state, additional source types, and
ejectable presets can extend the same surface.

A future lifecycle-aware hook could expose the raw map, feature source, asset
helper, instance identities, an abort signal, and mandatory cleanup. Publishing
it would create a versioned cross-extension contract with ordering, duplicate
ID, failure-isolation, and unload rules. No current fixture demonstrates that
requirement, so the hook remains a design sketch rather than shipped API.

Roam's [extension
lifecycle](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api)
defines the cleanup responsibilities of an installed extension. Roam also has
the trusted graph-code surface
[`roam/render`](https://roamdocs.fyi/developer-documentation/roam-render), but
the declarative map path must not evaluate arbitrary graph JavaScript.

## Verification guide for future agents

### Verify the sources before changing the design

1. Read the current Roam attribute and Alpha API documentation linked above.
2. Read the current MapLibre expression, layer, and image documentation linked
   above.
3. Check the version pinned in `package.json`.
4. When exact behavior matters, verify it against the installed
   `@maplibre/maplibre-gl-style-spec` and `maplibre-gl` version. Current online
   documentation can describe behavior newer than the pinned runtime.
5. Read the current GitHub issues, especially
   [#9](https://github.com/MaskyS/roam-map/issues/9),
   [#20](https://github.com/MaskyS/roam-map/issues/20) and
   [#21](https://github.com/MaskyS/roam-map/issues/21), the parity fixture in
   [#22](https://github.com/MaskyS/roam-map/issues/22), and basemap work in
   [#23](https://github.com/MaskyS/roam-map/issues/23), plus their latest
   comments.

### Current unit-level contracts

The current suite proves:

- `Profile Picture` is the feature key; no user-authored UID or
  `profilePictureImage` alias is required.
- The compiler retains the resolved attribute page UID internally.
- Current HARC, compatibility attributes, and exact `roam/meta::` structures
  produce the same public keys.
- An absent attribute omits the property and makes MapLibre `has` false.
- Text, number, boolean, page-reference, and multiple values follow the
  documented projection contract; reserved `roam/` titles are diagnosed.
- Exact image Markdown becomes a deterministic opaque asset token while other
  text remains text.
- The durable `MapLibre layer` parent form survives Roam's code-block
  normalization and accepts strict JSON even when the UI labels it JavaScript.
- The removed compact `maplibre-layer` fence is not recognized as either a
  layer or an accidental page source.
- Invalid JSON, invalid style specifications, duplicate layer IDs, reserved
  IDs, and foreign sources produce local diagnostics.
- Layer-definition blocks are configuration, not accidental map sources.
- A missing portrait leaves the base circle visible.
- An unavailable image selects the registered fallback.
- Roam-hosted images use the supported file API and register square and
  alpha-clipped `#circle` variants at 64 by 64 physical pixels and
  `pixelRatio: 2`.
- Style replacement restores the compiled source, authored layers, fallback,
  and runtime images.
- All five OpenFreeMap variants, EOX, and every configured MapTiler variant
  resolve through one catalog contract; arbitrary provider names do not enter
  source compilation.
- One MapTiler provider configuration produces Satellite and Hybrid entries
  without exposing its key in catalog or status objects.
- Updating MapTiler preserves stored records for other provider adapters that
  this build does not yet understand.
- Changing the key behind an unchanged basemap name changes its fingerprint
  and reapplies the style on a mounted map.
- Unknown names and unsupported stored schema versions fail visibly and fall
  back to OpenFreeMap Liberty; authenticated URLs are redacted from runtime
  errors.
- Stale image work is aborted or ignored by its generation guard.
- Source contributions deduplicate centrally by page UID before one batched
  place-resolution pass, while retaining every contributing block as
  provenance.
- Invalid GeoJSON positions, rings, and nested geometry collections are
  diagnosed before the renderer boundary.
- Pull-watch reconciliation cannot publish a stale generation or leak a watch
  whose asynchronous registration finishes after replacement or disposal.
- Clicking coincident rendered features exposes every distinct page UID for
  selection instead of silently choosing the top-painted feature.
- Marker click blocks are configuration rather than source leaves; inline and
  reusable code preserve stable UIDs, and reusable code adds a focused watch.
- Marker-click contexts encode arbitrary property text without permitting it to alter
  the generated `roam/render` invocation.
- Repeated clicks get distinct IDs, while graph refreshes do not replay a
  previously captured click.
- One map-level click query deduplicates overlapping interactive layers.
- Marker-click contexts identify selected pages without exposing internal image
  descriptors; component code can read `Image::` through the Alpha API.
- The stock public components share Roam's Blueprint 3 and React 18 runtimes
  and the `window.RoamMap` namespace is removed on extension unload.
- Page actions use Roam's documented right-sidebar outline window.

Use the installed style-spec package in focused tests when testing MapLibre
semantics. In particular, verify the difference between an unavailable image
and a missing property rather than mocking both as the same value.

When the query adapter lands, add focused contracts for result modes,
cross-source contributions, canonical deduplication, totals, caps, truncation,
failure, cancellation, and stale generations. A directly referenced page and
the same page normalized from a query must then produce the same geometry and
public attribute properties.

### Current live Roam fixture

Use `[[Roam Map Test]]` in the `maskys` graph. Its direct-source map contains
nine existing person pages plus the two native layers shown in Map A. Verify:

1. Reload through `roam reload-dev-extensions --graph maskys` and confirm the
   command explicitly lists `roam-map`.
2. Confirm both `MapLibre layer` parents compile without a map diagnostic and
   the map reports nine sources, nine mapped, and zero unmapped.
3. Change one layer value and confirm the native layer updates through the
   graph watch without remounting the map or rewriting source pages.
4. Edit one existing person's `Profile Picture` and confirm the feature and
   asset update without requiring a membership change.
5. Remove or break one image and confirm its ordinary point remains visible.
6. Preview Liberty, Positron, Bright, Dark, and Fiord. Confirm each OpenFreeMap
   style loads and portraits return after every `style.load`.
7. Preview `EOX Satellite Context`; confirm its visible attribution, 2016/10 m
   notice, useful zoom limit, and return to the saved map value.
8. Add one MapTiler key in the Roam Map settings panel. Use Satellite and
   Hybrid on different maps, rotate the key, and confirm both MapTiler views
   reload while OpenFreeMap and EOX entries do not. Inspect errors and
   diagnostics to confirm no authenticated URL is shown.
9. Confirm both same-coordinate people remain distinct and discoverable.
10. Test a Roam-uploaded file through the supported file API, including an
   encrypted graph when available.
11. Confirm the graph is not rewritten and a copied native layer remains
   understandable without an inspector.

The 2026-08-07 basemap checkpoint passed 53 tests, the bundle guard, and an
explicit CLI reload. The live nine-source People map switched from Liberty to
EOX, retained its circular portraits and ordinary points, and showed the
2016/10 m notice plus visible EOX/Copernicus attribution. Re-run the checks
above after changing the compiler or runtime; the recorded observation is
evidence, not a substitute for a new live test.

The later OpenFreeMap catalog follow-up also passed 53 tests, the production
build, and the bundle guard. The CLI reload explicitly listed `roam-map`. In
Roam Desktop, the selector exposed Liberty, Positron, Bright, Dark, and Fiord
as separate OpenFreeMap entries; the People fixture still reported nine
sources, nine mapped, and zero unmapped after reload. UI automation did not
complete the five visual style switches, so verification step 6 remains open
and should not be inferred from successful endpoint requests or unit tests.

The 2026-08-08 organization and state simplification passed 56 tests, the
production build, and the bundle guard. It did not receive a new authenticated
live-Roam pass because no signed-in graph was available. In particular, do not
infer the mount, watch, or coincident-selection behavior from unit tests alone;
rerun the live fixture after loading this build in Roam.

When #9 is implemented, add a second map fed by a child native query. Compare
its feature UIDs, properties, and presentation with the direct map; exercise
page and block result modes; add and remove matches through explicit Refresh;
and inspect truncation, failure, and ambiguity diagnostics. This is the parity
work tracked by #22.

Then run:

```bash
npm run check
```

Record the observed behavior, the installed versions, and the next experiment
in the project's normal experiment log. Do not promote a hypothesis in this
document to a settled contract solely because a synthetic unit fixture passes.

## Primary references

### Roam

- [Current attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new)
- [Compatibility attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model)
- [Roam data model](https://roamdocs.fyi/developer-documentation/data-model)
- [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api)
- [Query](https://roamdocs.fyi/help/query)
- [Roam Query Builder](https://roamdocs.fyi/help/roam-query-builder)
- [Images](https://roamdocs.fyi/help/images)
- [Roam Depot Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api)
- [`roam/render`](https://roamdocs.fyi/developer-documentation/roam-render)

### MapLibre

- [Style specification](https://maplibre.org/maplibre-style-spec/)
- [Sources](https://maplibre.org/maplibre-style-spec/sources/)
- [Layers](https://maplibre.org/maplibre-style-spec/layers/)
- [Expressions](https://maplibre.org/maplibre-style-spec/expressions/)
- [`get`](https://maplibre.org/maplibre-style-spec/expressions/#get)
- [`has`](https://maplibre.org/maplibre-style-spec/expressions/#has)
- [`case`](https://maplibre.org/maplibre-style-spec/expressions/#case)
- [`coalesce`](https://maplibre.org/maplibre-style-spec/expressions/#coalesce)
- [`image`](https://maplibre.org/maplibre-style-spec/expressions/#image)
- [Raster sources](https://maplibre.org/maplibre-style-spec/sources/#raster)
- [`Map#setStyle`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setstyle)
- [OpenFreeMap default styles](https://openfreemap.org/quick_start/)
- [OpenFreeMap 3D demo implementation](https://openfreemap.org/scripts/map.js)
- [MapTiler MapLibre styles](https://docs.maptiler.com/maplibre-gl-js/)
- [MapTiler public-key protection](https://docs.maptiler.com/cloud/api/authentication-key/)
- [EOxCloudless](https://cloudless.eox.at/)
- [`to-number`](https://maplibre.org/maplibre-style-spec/expressions/#to-number)
- [`global-state`](https://maplibre.org/maplibre-style-spec/expressions/#global-state)
- [Root `state`](https://maplibre.org/maplibre-style-spec/root/#state)
- [`Map.setGlobalStateProperty`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setglobalstateproperty)
- [Add an icon](https://maplibre.org/maplibre-gl-js/docs/examples/add-an-icon-to-the-map/)
- [Add custom icons with HTML Markers](https://maplibre.org/maplibre-gl-js/docs/examples/add-custom-icons-with-markers/)
- [`Map.addImage`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#addimage)
- [Generate a runtime image](https://maplibre.org/maplibre-gl-js/docs/examples/add-image-missing-generated/)
- [Fallback image](https://maplibre.org/maplibre-gl-js/docs/examples/use-a-fallback-image/)
- [`styleimagemissing`](https://maplibre.org/maplibre-gl-js/docs/examples/generate-and-add-a-missing-icon-to-the-map/)
