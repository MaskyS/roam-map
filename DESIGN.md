# Design notes

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the detailed ProseMirror and Roam
API audit behind these notes.

## Core model

Every rendered map is a union of typed inputs:

```text
source definition -> typed input items -> features or native resources -> render plan
```

A source adapter should expose a snapshot and an optional invalidation
subscription. It should not return live MapLibre map, source, or layer objects. Roam
entity sources may return stable page or block UIDs; coordinate and GeoJSON
sources retain their own explicit identities.

```js
{
  load: async () => ({ items, warnings, truncated }),
  subscribe: optionalInvalidateCallback => cleanup
}
```

Resolvers are selected by input kind. The page resolver deduplicates
page-backed places by page UID while preserving source provenance and group
membership. Map-local and external features use explicit source-derived IDs.

## Resolving feature data and presentation

Roam attribute projection and MapLibre presentation are separate concerns.
Page attributes become ordinary feature properties keyed by the readable
attribute page title, such as `Profile Picture`. The compiler resolves and
retains the attribute page UID internally for HARC reads, compatibility reads,
watches, and provenance. Users should not need to discover or author that UID.

MapLibre then consumes those properties through its native expression model.
A literal supplies one value, `get` reads a per-feature property, and
`global-state` can supply a map-wide value. Roam Map should not introduce a
`roam-attr(...)` expression or a generic renderer-neutral presentation
language.

Map resources follow the same native boundary. A style option should accept a
MapLibre style URL or a reference to a reusable MapLibre style specification,
while separate source and layer definitions remain possible. The current
`streets|satellite` switch is useful spike code, not the intended composition
boundary.

For ordinary point styling, use a native MapLibre layer rather than introducing
parallel `map/marker-shape` and `map/marker-size` vocabularies. A circle's shape
comes from the layer type and its size comes from `circle-radius`. A symbol
layer uses `icon-image` and `icon-size`; the latter is a scale factor, not a
pixel radius.

The initial projection experiment should expose suitable scalar page
attributes as flat, title-keyed feature properties and reserve `roam/` for
compiler-owned fields. Static expression analysis may add missing-property and
type diagnostics. Selective projection should be introduced only if live
measurements show that broad scalar projection is too large or invalidates too
much work.

Images require a separate runtime asset manager. The compiler can identify an
image attribute and produce an asset descriptor, but the MapLibre adapter must
resolve supported Roam files, decode and optionally transform them, register
them with the current style, restore them after style changes, and cancel stale
work. An image's minted runtime ID is a feature value, not a user-authored key.

The people fixture is also an identity test. Two people with the same
coordinates remain two features because page UID, never coordinate equality,
is identity. Rendering may offset, fan out, cluster, or otherwise reveal
coincident features, but it must not merge them.

The people fixture is therefore a test of general value resolution, not a
separate people-map mode. Advanced configuration should reach the same feature
properties and render plan through validated MapLibre layer blocks.

See [PRESENTATION.md](./PRESENTATION.md) for the complete walkthrough, exact
MapLibre and Roam references, expression edge cases, and the verification
contract.

## Proposed source forms

| Form | Meaning |
|---|---|
| Page references | Explicit place pages |
| `geo:` URI or attributed point block | Map-local coordinates without a page |
| Block reference | Reusable source outline, expanded with cycle detection |
| Inline native query | `roamAlphaAPI.data.roamQuery({query})` |
| Child native query | `roamAlphaAPI.data.roamQuery({uid})` |
| Search component | `roamAlphaAPI.data.async.search(...)` |
| `:q` block | Datalog with an explicit UID-producing result contract |
| GeoJSON code block | Validated external features with source-derived identity |
| `{{map: all}}` | Explicitly load the graph's known places |

Plain parent blocks with recognized source descendants can become named map
layers. One page may belong to multiple layers without producing duplicate
features.

## Query-result normalization

- A page result contributes itself when it has location data.
- A block result remains a typed block input. The first query adapter reports it
  as unsupported rather than guessing which place it represents.
- A later source-level result mode may explicitly select the block's owning
  page, its directly referenced pages, or both. The default must be chosen from
  live fixtures; owner and reference candidates are not silently combined.
- Query and search hits are not recursively expanded.
- Explicit block-reference collection sources may recursively expand their
  referenced outline.
- Raw `:q` sources should return `?uid`, `?page-uid`, or `?block-uid`; arbitrary
  strings and entity IDs are not guessed.

## Geographic feature model

The first MapLibre layer displays only points, but the internal feature
boundary should accept geometry from the beginning:

```js
{
  id,
  pageUid: optionalPageUid,
  title,
  geometry,
  address,
  groups,
  sourceUids
}
```

This lets point pages, map-local coordinates, polygons, and future GeoJSON
layers share source and provenance machinery. PMTiles, raster, and vector-tile
sources may remain native resources rather than being forced into GeoJSON.

## Reactivity

- Mount and load on first render.
- Watch the map block's source subtree for definition changes.
- Watch currently resolved place pages for location changes.
- Rerun sources when their definitions change.
- Give query, search, and Datalog sources an explicit refresh action.
- Do not rerun every expensive query after every unrelated graph edit.

The first milestone should prove the direct-reference loop before adding every
source adapter.

## Inline component seam

Roam currently documents full main-window component registration and rendering
existing Roam components into extension-owned nodes, but not registration of a
new inline parser component. Live desktop tests found that `{{map}}`,
`{{[[map]]}}`, and `{{map: all}}` all produce an otherwise inert default button
with the class `rm-xparser-default-map`. The argument is not present in that
button; the containing block UID must lead back to the authoritative string
through the Alpha API. The implemented adapter confines this undocumented seam
to mount discovery, verifies the authoritative block string before mounting,
and restores the fallback button during cleanup. The class and DOM layout
remain provisional rather than a settled registration contract.

If a contained DOM observer is required, it is only a mounting signal. Block
UIDs, source definitions, query results, and place data must be read through the
Roam Alpha API. Each visible render is its own instance because one block can
appear in the main window, sidebar, embeds, and block references simultaneously.
The live test confirmed separate main-window and sidebar nodes. In a block
reference, the rendered host UID and referenced definition UID differ; both
must be retained alongside a generated mount ID.

The first implementation now assigns each visible occurrence its own generated
mount ID, React root, live-source session, and MapLibre instance. Automated
tests cover replacement and cleanup, including duplicate and block-reference
mounts. A live Roam test confirmed independent bare, linked, inline-argument,
and block-reference occurrences on one page.

## Product feedback surfaces

The initial map should make the source pipeline legible:

- mapped count;
- skipped pages without location;
- source failures and truncation;
- refresh and fit controls;
- marker-to-page navigation; and
- stable viewport after the user starts navigating.

Later, the inline map can offer a maximized main-window view registered through
Roam's documented custom main-window component API.
