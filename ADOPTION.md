# Adopting Obsidian map capabilities in Roam Map

> Document role: this is a design proposal, produced from the 2026-08-09 review
> of Obsidian's official Bases Map view (`obsidianmd/obsidian-maps`) and the
> community Map View plugin (`esm7/obsidian-map-view`). **Nothing in this
> document is implemented.** Every Roam form shown here is a proposal, not a
> working example; [`customization.md`](./customization.md) and
> [`examples.md`](./examples.md) remain the only authoritative descriptions of
> current behavior. Grammar spellings are candidates until the pre-release
> grammar review in the final section.

## Sources and verification method

The Obsidian claims come from reading every page of both documentation sets and
the plugins' source: the official plugin's `map-view.ts` and `markers.ts` in
full, and Map View's module tree and dependency manifest. The Roam claims come
from reading, during this task, the current
[Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api),
[Roam Depot Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api),
[Query](https://roamdocs.fyi/help/query),
[Data Model](https://roamdocs.fyi/developer-documentation/data-model),
[current attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new),
and [Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries)
pages. MapLibre capability claims were checked against the packages this
repository pins (`maplibre-gl` 5.24.0 and its style spec): the `distance` and
`within` expressions exist, GeoJSON sources accept `cluster`, `clusterRadius`,
`clusterMaxZoom`, `clusterMinPoints`, and `clusterProperties`, and
`GeolocateControl` is exported. Claims that still require a live Roam
experiment are marked as such rather than asserted.

Two structural findings frame everything below:

1. The official Obsidian Maps plugin uses MapLibre GL JS 5.24.0 — the exact
   version Roam Map pins — with one GeoJSON source, one symbol layer of
   canvas-composited marker images, and a `setStyle`-then-restore cycle. All
   query, filter, and formula machinery lives in Bases; the plugin only
   renders. This is the division Roam Map already chose, with Roam in the role
   of Bases.
2. Map View is roughly ten times the surface (Leaflet, Svelte, its own query
   language, routing, offline tiles, GPS, drawing tools). Its own comparison
   document — the only comparison either side publishes — concedes vector
   rendering and Bases-formula marker styling to the official plugin while
   recording that the official plugin lacks inline multi-point locations,
   paths, geocoding, routing, GPS, and offline use. That concession table is
   the demand signal this plan follows.

Priority labels group features by importance, not implementation order. The
delivery sequence in `ARCHITECTURE.md` still governs order — in particular,
the direct-coordinate proof (P0-2) precedes the query family (P0-1).

---

## P0-1. Query-driven membership

### In Obsidian

Bases has no source list at all. A view implicitly starts from the entire
vault and filters narrow it down (`file.hasTag("places")`,
`file.inFolder("Trips")`, formula predicates), re-evaluated by the Bases
engine as the vault changes. The map view renders whatever survives the
filter. Map View instead ships its own boolean query language over its marker
index — `tag:#food AND linkedfrom:"Trip to Italy" AND NOT path:"bad places"` —
with operators for tags, paths, names, links in both directions, frontmatter
properties, line ranges, and geographic radius. Both products agree on the
core: membership is the live result of a predicate, not a hand-maintained
list.

### Roam adaptation

Roam already has the predicate language; the map must consume it rather than
invent one. Three adapters, matching the long-standing plan in
[`DESIGN.md`](./DESIGN.md) (issues #9, #10, #11), all using ordinary child
components:

```text
{{map}}
  Cafes
    {{[[query]]: {and: [[Cafe]] {not: [[Closed]]}}}}
  Coffee mentions
    {{[[search]]: coffee Mauritius}}
```

The optional group parent supplies a readable label and layer membership
(`roam/groups`); a query block directly under the map uses its query title,
when named, as the label. `{{map: all}}` — the closest analog of Bases'
whole-vault default — becomes a fourth adapter that maps every located entity
in the graph. Under the current attributes model it is one datalog query over
HARC entities:

```clojure
[:find ?uid
 :where [?a :node/title "Latitude"]
        [?harc :harc/a ?a]
        [?harc :harc/e ?e]
        [?e :block/uid ?uid]]
```

One documentation conflict must be recorded here rather than resolved
silently: the current attributes page documents querying harcs directly (with
`:harc/_e`/`:harc/_a` examples), while the Data Model page's "Internal"
section still lists `:harc/*` among entity families not to build on. This
plan follows the newer, dedicated attributes page — the same read path the
place resolver already uses — and the conflict goes to Roam support for
confirmation before the `{{map: all}}` adapter ships.

**Execution.** Never the rendered query DOM. Native queries run through
`roamAlphaAPI.data.roamQuery({uid, ...})` so the block's stored settings are
honored; search text runs through `roamAlphaAPI.data.async.search({"search-str",
limit, pull})`; raw Datalog runs through `roamAlphaAPI.data.async.q`, with
`roamAlphaAPI.data.backend.q` as an option for expensive queries (documented
caveats: the backend can lag the frontend while local edits sync, and it falls
back to local execution on encrypted or offline graphs). The `q`/`pull`
family documents a 20-second timeout, overridable with a `:timeout` clause in
Datalog (pulls take an `opts` timeout instead); no timeout is documented for
`search` or `roamQuery`, so the adapter must treat every source as failable
regardless.

**Caps and truncation.** `roamQuery` defaults to 20 results and accepts
`limit: null` for all, plus `offset` and a `pull` pattern; `search` defaults
to 300 with a maximum of 1000. The adapter must always pass an explicit limit
policy and surface truncation (`total` versus rendered) in the map bar and
results list. The API page tags only the four display settings as "query mode
only", implying `offset`, `limit`, and `pull` also apply in `uid` mode;
confirming that reading is already on the live-experiment list in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

**Result normalization — the actual substance.** Roam queries return blocks
and pages, and reference inheritance means a matching block often is not the
entity the author has in mind (a block matches everything its ancestors and
its page mention). A block result therefore contributes nothing until the
source declares a mode:

| Mode | Meaning |
|---|---|
| `pages` | Accept page results; diagnose block results |
| `owner-page` | A block contributes the page it lives on (`:block/page`) |
| `referenced-pages` | A block contributes the pages it directly references (`:block/refs`); location filtering happens downstream |
| `result-block` | The block itself is the mapped subject (a block-backed feature) |
| `owner-and-references` | Both, only on explicit request |

The pull pattern for query results should fetch what normalization needs in
one pass, for example `[:block/uid :node/title {:block/page [:block/uid]}
{:block/refs [:block/uid :node/title]}]`. The readable spelling of the mode —
the current candidate is a `map/result-mode::` attribute on the group block —
is a grammar-review item; the default must come from live fixtures, not
guessed (this is the parity work tracked as #22). Diagnostics must count each
funnel stage separately: returned entities, page candidates, referenced
candidates, mapped, skipped-unlocated, truncated, failed.

**Refresh semantics.** Native queries are not reactive by default, and no API
subscribes to a query's result set; a pull watch on the query block detects
definition edits but cannot discover a newly matching page. The honest
contract, unchanged from `ARCHITECTURE.md`: run on mount, rerun on definition
change, explicit **Refresh**, generation guards against stale completions.
The map's refresh policy is independent of the query block's own native
Reactive toggle, and the documentation should say so. Direct page-reference
sources keep their fully live pull-watch behavior; the two source kinds
coexist with different freshness, which the diagnostics surface should make
visible rather than hide.

**Dedup and provenance.** Query hits become source contributions
(`{sourceId, group, resultEntity, subject, normalizationMode, order}`) that
flow into the existing central deduplication by page UID. A page arriving both
directly and via a query is one feature with two memberships; removing one
contribution never removes a feature another source still supplies. A page
from a query must produce byte-identical feature properties to the same page
listed directly — same projection, same identity.

### Implementation surfaces

- Roam: `data.roamQuery`, `data.async.search`, `data.async.q`,
  `data.backend.q`, `data.addPullWatch`/`removePullWatch`,
  `data.async.pull_many` for batched place resolution (existing path).
- Map pipeline: new `src/map/query-sources.js` beside
  `src/map/direct-sources.js`, emitting the same contribution shape;
  `src/map/live-session.js` gains per-source refresh actions and keeps its
  serialized watch reconciliation and generation guards.
- UI: the existing Refresh control covers v1; per-source refresh and
  truncation badges extend `src/ui/map-view.jsx` and the results list with
  stock Blueprint `Button`/`Tag` components.
- A later semantic source — `roamAlphaAPI.data.async.semanticSearch`, guarded
  by `roamAlphaAPI.data.semanticSearchEnabled()` — fits the same adapter seam
  and has no Obsidian counterpart. Not part of the first query milestone.

### Open questions and risks

- `roamQuery` uid-mode interaction with `limit`/`pull`; effect of stored
  Group-by-Page and Nest-under-parent settings on the returned shape. Live
  experiment before freezing the adapter.
- Contextual `current/*` symbols in `:q` sources are rejected in v1, as
  already decided.
- Query cost on large graphs: prefer `backend.q` for `{{map: all}}`-scale
  sweeps, and respect the 20-second timeout with visible failure rather than
  silent emptiness.

---

## P0-2. Block-backed coordinate points

### In Obsidian

Map View's inline locations — `[Hudson River](geo:42.27,-76.15) tag:dogs` —
allow many markers per note, each with its own label and per-point tags (the
note opts in through a `locations:` frontmatter key the plugin normally adds
itself); its trip-planning workflow depends on them. The official plugin
cannot do this (one frontmatter location per file) — a gap Map View's
comparison table records as "Not supported" in the official plugin. File
granularity is the limiting factor; Roam's block granularity removes it.

### Roam adaptation

Roam Map now implements the two forms designed in `ARCHITECTURE.md`:

```text
{{map}}
  geo:-20.1609,57.5012
  Port Louis Waterfront
    Coordinates:: geo:-20.1609,57.5012
```

- **Bare `geo:` URI** ([RFC 5870](https://www.rfc-editor.org/rfc/rfc5870.html)):
  latitude first, WGS84 default. The parser rejects non-finite numbers,
  latitude outside [-90, 90], longitude outside [-180, 180], and any `crs`
  other than absent/`wgs84`; a `u=` uncertainty parameter is preserved as
  feature metadata. Markdown links, altitude, unknown parameters, exponent
  notation, and trailing prose are rejected. A bare URI labels itself from
  the coordinates.
- **Attributed point block**: a block whose text is the label, with
  a `Coordinates:: geo:…` child. Under the current attributes model
  these harcs describe the parent block (`:harc/e` is the parent), so the
  block is the located entity. Additional attributes on the block (category,
  URL, notes) project into feature properties exactly as page attributes do.

Both forms compile to the same `geo/point` input. Identity is the source block
UID; the GeoJSON boundary flips to longitude-first per RFC 7946, as the
existing geometry code already does.

**Two parser rules keep the result explicit.** A block with its own
`Coordinates` attribute is a block-backed source even when its text also
contains page references; the explicit location is not reassigned to one of
those pages. Both current HARC and compatibility attribute representations are
read, including values beneath one exact `roam/meta::` child. A current value
takes precedence and disagreement remains visible as a diagnostic.

**Per-point grouping.** Map View's inline `tag:` syntax is not adopted. A named
point may use an ordinary scalar attribute such as `Category:: Viewpoint` for
MapLibre filtering. Source-group membership remains separate future work.

**Marker interaction.** Version 2 of the click context uses `entityUid` plus
`identityKind` for pages and blocks. The stock card opens either through the
documented right-sidebar outline window with the entity's stable UID.

### Implementation surfaces

- Roam: block string via the existing balanced scanner; attributes via the
  HARC read path in `src/roam/`; pull watches per point block
  (`[:block/string {:block/children ...}]` plus attribute pattern), reconciled
  by the existing live-session machinery.
- Map pipeline: `src/map/direct-sources.js` emits page- or block-identified
  contributions; `src/map/place-records.js` resolves both through one location
  record boundary.
- Authoring: an `extensionAPI.ui.slashCommand.addCommand` entry ("Insert map
  point") — the documented insertion route, consistent with the project rule
  that slash commands insert canonical forms. The docs specify returning a
  string inserted at the cursor; whether a newline-containing string produces
  child blocks is undocumented, so the command inserts the single-block
  `geo:` form unless a live experiment shows outline-shaped insertion works.
- MapLibre/React: nothing new; points join `roam-map-features`.

### Open questions and risks

- Label derivation for the aliased form when the alias contains further Roam
  markup; render as plain text v1.
- Whether `Geometry::` on a block should be honored symmetrically with pages
  (defer; points first).

---

## P0-3. No-code marker styling preset

### In Obsidian

The official plugin's entire styling surface is two view settings: a marker
icon property (a Lucide icon name such as `landmark`) and a marker color
property (any CSS color, including `var(--color-blue)`). At render time it
composites a 24px circle plus the icon SVG onto a 48px canvas at 4x, registers the
result as a style image keyed by icon+color, and drives one symbol layer with
`icon-image: ["get", "icon"]` where the key was precomputed into each
feature's properties. Bases formulas add indirection — an icon read from a
linked "type" note. Map View reaches similar results through its display-rule
cascade (default rule, then query-matched rules overriding individual
properties, plus badges).

Both products converge on the requirement: icon and color from note data, no
JSON authored by the user.

### Roam adaptation

A thin preset, exactly as [`PRESENTATION.md`](./PRESENTATION.md) prescribes:
it compiles to the same feature properties and native layers an advanced user
could write by hand, and it can be ejected. Two map options name the attribute
pages that supply values:

```text
{{map}}
  map/marker-icon:: Icon
  map/marker-color:: Color
  [[Port Louis]]
```

Place pages then carry ordinary attributes (`Icon:: landmark`,
`Color:: #d9822b`). Semantics:

- The compiler resolves each feature's icon name and color from the projected
  attributes, mints a composite image key, and writes it to a compiler-owned
  property (`roam/markerImage`). Precomputing the key per feature — the
  official plugin's `imageKey` technique — avoids sanitizing arbitrary color
  strings inside MapLibre expressions.
- The runtime composites the marker image (circle + icon glyph + color) on a
  canvas and registers it through the existing image-asset pipeline: 64×64
  physical pixels at `pixelRatio: 2`, deduplicated by key, restored after
  `Map#setStyle`, stale work cancelled by generation.
- The preset contributes two stock layers under reserved IDs
  (`roam-map/preset-base`, `roam-map/preset-symbol`): a base circle so a bad
  icon or color never hides a place, and a symbol layer whose `icon-image` is
  `["coalesce", ["image", ["get", "roam/markerImage"]], ["image",
  "roam-map/default-marker"]]` behind a `has` filter — the exact pattern the
  portrait recipe already uses.
- Preset layers render beneath authored `MapLibre layer` blocks. The preset is
  sugar over the existing render plan, not a second styling language.
- **Eject**: an explicit command copies the generated layer JSON so the author
  can paste it as ordinary `MapLibre layer` blocks and continue with native
  MapLibre. The extension never rewrites the outline itself.

Map View's rule cascade is deliberately not adopted. Its job — "everything in
group X looks like Y" — needs no second rule engine: once group membership is
projected as the `roam/groups` property (planned alongside query memberships
in `PRESENTATION.md`, not implemented today), it is an ordinary authored
layer filtered on `["in", "X", ["get", "roam/groups"]]`. Badges are likewise deferred; they are
additional symbol layers if ever needed. Bases-style indirection (icon defined
on a referenced "type" page) would require projecting attributes of referenced
pages; noted as a future projection extension, not part of the preset.

### Implementation surfaces

- Icon set — decision required, with a live experiment either way:
  - *Option A*: Blueprint icons. Roam ships `window.Blueprint.Core` (3.x),
    but canvas rasterization needs the SVG path data
    (`@blueprintjs/icons` `IconSvgPaths16`), and whether the window global
    exposes it is undocumented. Verify in a live client before choosing.
  - *Option B*: bundle a curated subset of Lucide (ISC-licensed) as SVG
    strings. Predictable, and it matches the official plugin's icon
    vocabulary; the production bundle guard caps the cost.
- Color: literal CSS colors in v1, validated at compile time; `var(--…)`
  values are diagnosed as unsupported until a theme-resolution story exists
  (the official plugin resolves them against a probe element — feasible, but
  it couples marker rendering to theme state; see dark basemaps).
- Modules: option parsing beside `src/map/options.js`; key minting in the
  compiler; compositing in `src/maplibre/image-assets.js`; preset layers in
  `src/map/layers.js` under the reserved `roam-map/` namespace.
- Roam: nothing new — attribute projection and `roam/` reservation already
  exist.

### Open questions and risks

- Attribute-name defaults: fixed `Icon`/`Color` versus mandatory explicit
  `map/marker-icon` — grammar review item. Explicit naming mirrors the
  official plugin's property picker and avoids colliding with unrelated
  `Icon::` attributes.
- Composite image count is bounded by distinct icon+color pairs, not by
  features; still worth a cap plus diagnostic.

---

## P0-4. Explicit saved camera

### In Obsidian

The official plugin keeps pan/zoom as ephemeral navigation state and persists
a camera only when the user explicitly right-clicks → "Set default center
point" / "Set default zoom", which writes the view configuration. Bases stores
center, default zoom, and zoom constraints per view. Map View's presets save
pan/zoom plus the active query and optionally the map source, under a name.

### Roam adaptation

One atomic child, written only by an explicit toolbar action — the same
pattern `map/size` already established:

```text
{{map}}
  map/view:: -20.1609, 57.5012 @ 11
```

Semantics:

- **Save view** writes the current center (latitude, longitude — outline
  order matches the `geo:` convention) and zoom (0–24, one decimal). **Reset
  view** deletes the child. Panning and zooming never write anything.
- A saved view replaces fit-on-first-result as the initial camera; the
  explicit **Fit** control still works, and later refreshes preserve the
  user's viewport exactly as today.
- The value belongs to the definition block, so block-reference renderings
  share it — but only newly mounted views adopt a changed value. Yanking the
  camera of an already-navigating view on pull-watch invalidation would
  violate the stable-viewport rule; the invalidation updates stored state
  only.
- Bearing and pitch are deliberately out of v1; the `@` format leaves room if
  3D view configuration ever lands (the OpenFreeMap "3D is camera, not style"
  decision in `ARCHITECTURE.md` applies).

Map View's named multi-preset system is not adopted: Roam's idiom for "another
saved arrangement" is another `{{map}}` block or a block reference, and its
`obsidian://` view URLs have no Roam counterpart for extension state.

### Implementation surfaces

- Persistence: a module parallel to `src/map/size-persistence.js` — find the
  existing `map/view` child, `data.block.update` it, or `data.block.create`
  beneath the definition; delete on reset. One write per gesture, far inside
  the documented budget of 1500 rate-limited calls (all writes plus a number
  of UI functions) per 60 seconds.
- UI: toolbar Save/Reset actions with the existing Blueprint button styling;
  a saved-view indicator mirrors the saved-size treatment.
- Parsing/validation joins the options path with range clamps and
  diagnostics; camera application lives in `src/maplibre/runtime.js` at mount.

### Open questions and risks

- One combined value versus separate `map/center`/`map/zoom`: combined is
  atomic (no torn state between two children) and matches `map/size`
  precedent. Grammar review item.

---

## P1-5. Dark-mode basemap pairing

### In Obsidian

Both products treat dark tiles as table stakes: Map View gives every map
source an optional dark URL and switches when Obsidian's dark theme is
active; the official plugin pairs `mapTiles`/`mapTilesDark`, listens to the
workspace `css-change` event, and swaps styles on theme change.

### Roam adaptation

The catalog gains an optional dark counterpart per entry — a pairing between
two named entries (for example `OpenFreeMap Liberty` paired with `OpenFreeMap
Dark`), editable wherever the entry is configured. `map/basemap` semantics do
not change: the saved name still resolves through the registry; when the dark
variant should apply, the registry resolves the paired entry instead, the
fingerprint changes, and the existing `setStyle`-and-restore machinery does
the rest.

The honest difficulty is detection. Roam documents no theme API and fires no
theme event. Options, in order of decreasing honesty:

1. `window.matchMedia("(prefers-color-scheme: dark)")` — documented browser
   surface, detects the OS preference, with a `change` listener cleaned up on
   unload. It does not know about Roam-specific themes.
2. Observing a Roam DOM theme class — an undocumented seam. Per the AGENTS.md
   rule, this may be adopted only after a live experiment establishes the
   smallest reliable signal, and it must be confined to the existing DOM-seam
   boundary and treated as provisional.
3. A graph-wide manual toggle in the settings panel as override for both.

Ship (1) + (3); promote (2) only with live evidence.

### Implementation surfaces

- `src/settings/basemap-registry.js`: pairing field in the versioned catalog
  schema (unknown fields already survive round-trips), resolution branch, and
  fingerprint participation so mounted maps restyle.
- `src/settings/basemap-settings.jsx`: a paired-entry selector per custom
  entry; built-ins ship sensible default pairs.
- The media-query listener lives in extension composition
  (`src/extension.js`) and publishes through the registry's existing
  subscription; React consumes it via the current `useSyncExternalStore`
  path.

### Open questions and risks

- Attribution obligations can differ between paired providers; the pair must
  each keep their own attribution, which the per-entry model already
  guarantees.

---

## P1-6. "Open in" external services

### In Obsidian

Map View lets users configure external-service entries — a name plus a URL
template with `{x}` (latitude), `{y}` (longitude), `{name}` — surfaced in
every marker, map, and note context menu (Google Maps, OSM, Waze examples).
The official plugin offers "Copy coordinates" on both map and marker menus and
suggests a formula-built Google Maps link for popups.

### Roam adaptation

Pure client-side URL construction; no network from the extension, no keys.

- **Graph-wide setting**: a versioned list of `{name, template}` entries in
  `extensionAPI.settings`, edited in the settings panel next to the basemap
  catalog, honoring `settings.canSet`. Templates use readable parameters —
  `{latitude}`, `{longitude}`, `{name}` — substituted with
  `encodeURIComponent`, and must be `https://` URLs. Defaults: OpenStreetMap
  and Google Maps.
- **Stock card**: `MarkerCardActions` gains an "Open in" affordance (Blueprint
  `Popover` + `Menu`/`MenuItem`, matching the card's existing Blueprint 3
  usage) listing the configured entries; selection opens
  `window.open(url, "_blank", "noopener")`. The action list also joins the
  card-controller object so custom `Marker click` components can reuse it, a
  versioned addition to the public component API.
- **Map background context menu**: right-click (MapLibre `contextmenu` event)
  opens a small Blueprint menu at the pointer with "Copy coordinates"
  (`navigator.clipboard.writeText`), "Copy geo: block" (the canonical point
  form, ready to paste into an outline), and the configured Open-in entries
  for the clicked location. This mirrors the official plugin's map menu while
  keeping every item read-only with respect to the graph.

### Implementation surfaces

- Settings: same versioned-object pattern as basemap providers, in a new
  `src/settings/open-in.js`; redaction rules are unnecessary because entries
  contain no credentials, but the doc treats templates as collaborator-visible
  configuration.
- Runtime: the context-menu handler joins the marker-click handler set owned
  by `src/maplibre/runtime.js`; menu rendering is a React portal owned by the
  map view.

### Open questions and risks

- Template injection: substitution must encode values, and the settings UI
  should reject templates whose parameters appear inside anything other than
  query/path positions only if that proves practical; encoding alone already
  prevents URL-structure escape.
- Touch devices have no right-click; a long-press mapping needs a live check
  on Roam mobile clients.

---

## P1-7. GeoJSON sources and non-point geometry

### In Obsidian

Map View renders stand-alone GPX/KML/TCX/GeoJSON files from the vault and
inline GeoJSON in a ` ```geojson ` fence (with a `tag:` line for membership),
styled through display rules; Edit Mode draws paths and writes them back. The
official plugin renders points only.

### Roam adaptation

The escape hatch already sketched in `ARCHITECTURE.md`, using the grammar
lesson from `MapLibre layer`: a readable parent block plus one ordinary JSON
code block. The reason is a recorded project observation, not a documented
contract — live testing behind [`PRESENTATION.md`](./PRESENTATION.md) found
Roam can normalize unknown custom fence languages, which is why the compact
`maplibre-layer` fence was removed:

```text
{{map}}
  Shoreline walk
    GeoJSON
      ```json
      {"type": "FeatureCollection", "features": [...]}
      ```
```

Semantics:

- Validation before anything renders: RFC 7946 structure, finite WGS84
  positions, ring closure, a size cap with a diagnostic, no JavaScript
  execution. Feature identity follows the existing rule —
  `sourceBlockUid + String(feature.id)` when an ID exists; otherwise a
  snapshot-local index ID carrying the documented stability warning.
- Source properties pass through as feature properties; keys colliding with
  the reserved `roam/` prefix are diagnosed, not renamed.
- **Rendering**: stock geometry layers over the compiled source, filtered by
  `["geometry-type"]` — a line layer for LineString/MultiLineString, fill plus
  outline for Polygon/MultiPolygon, the existing point path for points. This
  also retires the current "non-point geometry is reported, not drawn"
  limitation for page `Geometry::` values, which compile through the same
  plan. Authored layers can target the same features for custom styling.
- **Fit** must extend bounds over all geometry coordinates, not marker points
  only.
- Interaction: clicking a non-page feature produces a click context with its
  source-derived `entityUid` and `identityKind`; the stock card shows the feature's label and properties and
  offers "Open source block" through the sidebar block window. This rides the
  same context version bump as block-backed points.
- Group membership comes from the group parent, as with every other source;
  Map View's `tag:` line is not adopted.

GPX/KML/TCX are not parsed natively. If import demand materializes, the
correct shape is an explicit conversion command that writes a GeoJSON block
once (comparable to Map View's KML import), not a second geometry format in
the compiler. Deferred.

### Implementation surfaces

- Map pipeline: a `geojson-sources.js` adapter emitting `geo/feature` inputs
  (the union member already exists in the design); geometry validation extends
  the existing strict validator.
- MapLibre: line/fill layers in the stock plan (`src/map/layers.js` reserved
  IDs); no new source machinery — features join `roam-map-features`.
- Results list: v1 keeps the list page-oriented and reports GeoJSON features
  in the counts; whether rows should represent non-page features is an open
  product question.

### Open questions and risks

- Serialized size: measure compiled collections with realistic tracks; the
  size cap and the existing "measure before freezing projection breadth"
  discipline apply.
- Very large geometries may warrant `tolerance`/`buffer` tuning on the GeoJSON
  source — both exist in the pinned style spec — but only with measurements.

---

## P1-8. Maximized main-window map

### In Obsidian

Map View's primary mode is a full workspace view (like Graph View), with
embeds as the secondary form. Roam Map inverted this: inline-first. The
missing counterpart is a maximized view for serious panning and querying.

### Roam adaptation

Roam documents exactly this surface:
`roamAlphaAPI.ui.mainWindow.registerComponent(id, component)` registers a
custom full-window React view, `openComponent(id, ...args)` opens it with
arguments (reported by `getOpenView` as `{type: "custom", id, args}`), and
`closeComponent(id)` closes it. Registration happens at extension load,
unregistration at unload.

- A **Maximize** toolbar action on every inline map calls
  `openComponent("roam-map", definitionUid)`. The component reads the
  definition UID from its arguments and mounts a full-size map view of the
  same definition.
- View identity follows the existing rules: same definition UID, a distinct
  host identity ("main-window custom view"), and a generated mount ID — its
  own React root, live session, and MapLibre instance, sharing nothing mutable
  with inline views of the same definition. `map/size` is ignored; the view
  fills the main window with responsive CSS.
- A **Back to note** affordance inside the view calls
  `mainWindow.openBlock({block: {uid: definitionUid}})`.

### Implementation surfaces

- Roam: `mainWindow.registerComponent`/`openComponent`/`closeComponent`/
  `getOpenView`; `window.React` (the component must use Roam's React, which
  the build already externalizes).
- UI: `src/ui/` gains the maximized wrapper; everything inside reuses
  `map-view.jsx`.

### Open questions and risks

- Live experiments required before shipping: whether Roam unmounts the
  component on navigation (cleanup must also survive `closeComponent` and
  extension reload), how navigation history treats custom views, and how
  component arguments are delivered to the React component (the API page
  documents the call and the `getOpenView` report, not the component's
  prop contract).

---

## P2-9. Marker clustering

### In Obsidian

Map View clusters via Leaflet.markercluster with a configurable maximum
cluster radius. The official plugin ships no clustering — overlapping icons
with `icon-allow-overlap: true`, exactly Roam Map's current behavior — which
is useful evidence that clustering is not a launch blocker.

### Roam adaptation

Opt-in per map (`map/cluster:: on`, spelling subject to grammar review),
becoming relevant when `{{map: all}}`-scale sources land. MapLibre supports it
natively: the GeoJSON source options `cluster`, `clusterRadius`,
`clusterMaxZoom`, `clusterMinPoints`, and `clusterProperties` are all present
in the pinned style spec.

The composability decision matters more than the mechanics. Clustering
changes what features the source emits at low zoom, which would silently
change the meaning of every authored `MapLibre layer` over
`roam-map-features`. Two designs:

1. Toggle clustering on `roam-map-features` itself and document that authored
   layers see cluster features (filter with `["has", "point_count"]` /
   `["!", ["has", "point_count"]]`).
2. Add a parallel `roam-map-features-clustered` source used only by the stock
   cluster layers, leaving `roam-map-features` semantics untouched.

Option 2 preserves the authored-layer contract at the cost of a duplicated
source; it is the recommended starting point.

Stock rendering: a cluster circle layer stepped on `["get", "point_count"]`, a
count label, and the unclustered stock marker filtered to non-clusters.
Cluster click calls `getClusterExpansionZoom(clusterId)` on the source and
eases the camera. The coincident-marker chooser remains necessary — clusters
at `clusterMaxZoom` still resolve to coincident points.

### Open questions and risks

- Count labels are symbol `text-field`s. Since MapLibre GL JS 5.11.0 a style
  without a `glyphs` endpoint falls back to locally generated fonts — the
  pinned 5.24.0 style spec marks `glyphs` optional and the pinned runtime
  draws such glyphs locally — so cluster counts render even over the small
  generated raster-template styles, which set no `glyphs`. The live check
  should confirm the locally rendered labels look acceptable there.
- Cluster interaction with the marker-click context (a cluster is not a
  page): cluster clicks zoom; they never produce a marker-click event.

---

## P2-10. Geographic distance filtering

### In Obsidian

Map View's `distancefrom:lat,lng<5km` query operator filters markers by
straight-line distance, composable with the rest of its query language; its
CLI exposes the same predicate to agents.

### Roam adaptation

Not a query-language feature — Roam queries know nothing of geography, and
teaching the map's source adapters a geographic predicate would blur the
boundary between graph membership and spatial presentation. Two map-side
routes:

1. **Now, as documentation**: the pinned style spec includes the `distance`
   expression (meters to an input geometry) and `within` (containment in an
   input polygon). An authored layer can already express "only show features
   within 2 km of X" as a filter such as
   `["<=", ["distance", {"type": "Point", "coordinates": [57.5012, -20.1609]}], 2000]`
   once a tested recipe is added to `examples.md`. Behavior must be verified
   against the pinned runtime before the example is published, per the
   existing verification rule.
2. **Later, as UX**: a transient radius tool (choose center, drag radius)
   that applies the same filter to the stock layers at runtime and never
   writes to the graph — presentation state in the same category as basemap
   preview.

A compile-time variant (dropping features outside a radius before rendering,
so the results list and counts agree with the map) would be a map option with
grammar implications; deferred until the layer-filter route proves
insufficient.

---

## P2-11. Reference edges between markers ("links view")

### In Obsidian

Map View can draw edges between the markers of linked notes — source note to
destination file, heading, or block — with a documented performance warning.
Nothing similar exists in the official plugin.

### Roam adaptation

Roam is the linked-notes tool; a map that shows which mapped places reference
each other is an on-brand differentiator. The data is native: `[[links]]`,
`#tags`, `attribute::`, and `((refs))` all create identical `:block/refs`
datoms, and backlinks are the reverse ref `:block/_refs`.

- **Semantics**: for the compiled set of mapped pages P, an edge A→B exists
  when any block on page A references page B, with both in P. Edges
  deduplicate as unordered pairs in v1 (direction as presentation is a later
  option); provenance keeps the contributing block UIDs so an edge click can
  cite its evidence.
- **Computation**: per mapped page, a reverse-ref pull (`:block/_refs`
  filtered to blocks whose `:block/page` is also in P) or one Datalog query
  with the mapped set bound through `:in`; run at compile and on explicit
  refresh only — never per graph edit, which is the failure mode Map View's
  performance warning describes.
- **Rendering**: LineString features in a separate extension-owned source
  (`roam-map-links`, following the `roam-map-features` source-naming
  convention; the `roam-map/` slash prefix stays reserved for layer IDs and
  style images) with one stock line layer beneath markers; toggled by a
  durable `map/links:: on` option with a transient toolbar preview, the same
  durable/transient split the basemap selector uses.
- **Interaction**: edge clicks produce a context naming both page UIDs
  (rides the same click-context version bump).

### Open questions and risks

- Cost is O(blocks on mapped pages); acceptable at direct-source scale,
  needs measurement at `{{map: all}}` scale, and the results should state
  when edge data is stale relative to the marker data (refresh-only policy).
- Page-level edges only in v1; block-to-block edges (Map View's
  heading-scoped destinations) add precision later if wanted.

---

## P2-12. Agent tools

### In Obsidian

Map View registers Obsidian CLI commands (`mv-geosearch`, `mv-query`,
`mv-calc-distance`, `mv-calc-route`, `mv-focus-note`) and ships a Claude
skill, so agents can look up coordinates, query markers, and build trip notes.
It is the plugin's newest investment area.

### Roam adaptation

Roam's counterpart surface is `extensionAPI.ai.addTool` (marked
`#experimental`): extension-registered tools are namespaced
(`<extension-id>/<name>`), advertised to agents connected through the local
MCP or CLI (not remote MCP), validated against a draft-07 `inputSchema`, and
removed automatically on unload, with at most 25 per extension.

Read-scope tools that fit Roam Map's boundary:

- `list-map-places` — input `{mapUid?}`; compiles the definition through the
  existing pure pipeline and returns places with coordinates, groups, and the
  unmapped list with reasons. Because compilation is pure and read-only, the
  tool needs no mounted view.
- `list-located-pages` — the `{{map: all}}` query as a tool: every page with
  a valid `Coordinates` geo URI or renderable geometry.

Both declare `scope: "read"`; no write tools — creating or editing places is
Roam Places' capture domain, and the boundary holds for agents exactly as for
humans. Geocoding and routing tools are likewise out of scope (no
provider relationships in Roam Map).

### Implementation surfaces

- `extensionAPI.ai.addTool` in extension composition, handlers delegating to
  the compiler; JSON-serializable return values shaped for reading, per the
  API's guidance.
- A settings toggle (default on or off — product decision) acknowledging the
  API's experimental status; registration is skipped when disabled.

### Open questions and risks

- The API is experimental and may change; the handlers are thin, so the
  exposure is small. Keep tool names and schemas versioned in one module.

---

## P2-13. Geolocate control

### In Obsidian

The official plugin adds a geolocate control on mobile only, with a source
comment noting that desktop Electron grants the permission but has no
location provider, so requests hang. Map View integrates real GPS through
Obsidian Mobile 1.11's location permission, including follow-my-location and
auto-filling the current location into notes.

### Roam adaptation

Roam documents no geolocation surface, so only the browser API is available,
and the Electron caveat transfers directly to Roam Desktop. The honest
version:

- Add MapLibre's built-in `GeolocateControl` (present in the pinned package)
  as a transient control, enabled only where a live test shows
  `navigator.geolocation` actually resolves — expected: the web client;
  suspect: the desktop app; unknown: mobile apps. Platform gating uses
  `roamAlphaAPI.platform.isDesktop` / `isMobileApp` / `isTouchDevice`.
- The location is never persisted, never written to the graph, and never
  leaves the client; the control's lifecycle ends with `map.remove()`.
- Map View's auto-add-location-to-daily-note behavior is capture and belongs
  to Roam Places, if anywhere.

This ships only after a per-platform live matrix; until then the control
stays behind a default-off setting.

---

## Declined capabilities

Recorded so future work does not relitigate silently. Each is declined for
permanent-cost or boundary reasons, not implementation effort.

- **Offline tile storage** (Map View: IndexedDB cache plus batch download
  jobs). A permanent storage/eviction/ToS surface aimed at offline field use;
  Roam is web-first and the provider-terms exposure (the docs themselves
  hard-cap download jobs at a million tiles) outweighs the audience. Roam
  ships `window.idb`, so the capability is technically reachable — that is
  not the constraint.
- **Routing** (GraphHopper API). Third-party account, quota, and a second
  network dependency for a job the Open-in entries and user-authored
  `Marker click` components already cover.
- **Geocoding, URL parsing, clipboard capture, Edit Mode drawing-to-notes,
  KML import, auto-location**. All are place capture — Roam Places' domain
  under the product boundary. Roam Map's contributions are the read-only
  affordances above (copy coordinates, copy a canonical point block) and a
  visible handoff to Roam Places.
- **A display-rule engine** (Map View's query-based cascade). Adapted, not
  adopted: group membership plus native MapLibre filters express the same
  outcomes inside one vocabulary; the styling preset covers the no-code
  cases.
- **Named multi-view presets and view URLs**. Roam's idiom is multiple map
  blocks and block references; extension state has no documented deep-link
  surface.
- **Follow-active-note**. Attractive, but it requires both query sources and
  a navigation signal; Roam documents `mainWindow.getOpenView` but no
  navigation event, so this waits on the query family and a polling-free
  design.

---

## Cross-cutting concerns

**Grammar freeze.** Bare `geo:` blocks and named `Coordinates` blocks are now
implemented. This plan proposes the remaining durable forms:
`map/view`, `map/marker-icon`, `map/marker-color`, `map/cluster`,
`map/links`, `map/result-mode` (per source group), and the `GeoJSON` parent
form. The project is unreleased: hold one grammar review
covering all of them together before anything ships, because after release
every spelling is permanent (the registry's rename-alias mechanism covers
catalog names, not outline grammar).

**Options engine first.** Six new options justify implementing the
`OptionDefinition` pattern from `ARCHITECTURE.md` (parse, validate, scopes,
inherit, serialize) before adding them, so each option is one declaration
rather than one more ad hoc parser.

**Freshness is per source kind.** The honest invalidation table the UI should
reflect:

| Source kind | Freshness |
|---|---|
| Direct page references | Live (focused pull watches) |
| Block-backed points | Live (block pull watches) |
| Query / search / `:q` / `map: all` | On mount, on definition edit, on explicit Refresh |
| GeoJSON blocks | Live (code block pull watch) |
| Reference edges | Recomputed on compile/refresh only |

**Click-context versioning.** Version 2 is implemented for page- and
block-backed markers through `entityUid`, `identityKind`, `entityUids`, and
`coincidentEntityUids`. Future GeoJSON features and edge clicks should use that
identity model where it is sufficient and require another version only when
their schema genuinely changes the public context.

**API budget honesty.** The `q`/`pull` read family documents a 20-second
timeout; rate-limited functions — all writes plus a number of UI functions —
share a budget of 1500 calls per 60 seconds. Every write in this plan is a
single explicit user action (save view, save size); nothing writes in a loop
or as a rendering side effect.

**Settings governance.** Every new settings surface (Open-in list, dark
pairing, AI-tools toggle) honors `settings.canSet` and the existing
versioned-object pattern with unknown-field preservation.

**Mobile and touch.** Blueprint 3 popovers and context menus need a touch
review (no right-click; long-press semantics unverified in Roam mobile
clients). The resize grip precedent (keyboard-accessible alternative) is the
bar for any pointer-only interaction added here.

**Bundle and cleanup guards.** The icon set and any new module pass the
existing production bundle guard (single MapLibre license marker, no second
React, size cap). Every new listener — media query, context menu, geolocate,
main-window component — registers cleanup through the existing ownership
tree, and each disposal remains idempotent.

**Testing.** Each feature lands with focused tests mirroring `test/`'s folder
structure, plus additions to the live-Roam fixture checklist in
`PRESENTATION.md`: `roamQuery` uid-mode parameter behavior, main-window
component lifecycle, theme detection, Blueprint icon-path availability, and
the geolocate platform matrix are the experiments this document explicitly
leaves open.

## Primary references

- Both plugin reviews: [Obsidian Bases documentation](https://help.obsidian.md/bases)
  (source: `obsidianmd/obsidian-help`), [Map View documentation](https://esm7.github.io/obsidian-map-view/),
  [`obsidianmd/obsidian-maps`](https://github.com/obsidianmd/obsidian-maps),
  [`esm7/obsidian-map-view`](https://github.com/esm7/obsidian-map-view).
- Roam: [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api),
  [Roam Depot Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api),
  [Query](https://roamdocs.fyi/help/query),
  [Data Model](https://roamdocs.fyi/developer-documentation/data-model),
  [Current attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new),
  [Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries).
- Geographic: [RFC 5870](https://www.rfc-editor.org/rfc/rfc5870.html),
  [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946),
  [MapLibre style specification](https://maplibre.org/maplibre-style-spec/)
  as pinned by this repository's `package.json`.
