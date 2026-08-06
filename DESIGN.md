# Design notes

## Core model

Every rendered map is a union of sources:

```text
source definition -> entity UIDs -> place page UIDs -> geographic features
```

A source adapter should expose a snapshot and an optional invalidation
subscription. It should not return renderer-specific marker objects.

```js
{
  load: async () => ({ pageUids, warnings, truncated }),
  subscribe: optionalInvalidateCallback => cleanup
}
```

All adapters feed one resolver. The resolver deduplicates by page UID while
preserving source provenance and group membership.

## Proposed source forms

| Form | Meaning |
|---|---|
| Page references | Explicit place pages |
| Block reference | Reusable source outline, expanded with cycle detection |
| Inline native query | `roamAlphaAPI.data.roamQuery({query})` |
| Child native query | `roamAlphaAPI.data.roamQuery({uid})` |
| Search component | `roamAlphaAPI.data.async.search(...)` |
| `:q` block | Datalog with an explicit UID-producing result contract |
| `{{map: all}}` | Explicitly load the graph's known places |

Plain parent blocks with recognized source descendants can become named map
layers. One page may belong to multiple layers without producing duplicate
features.

## Query-result normalization

- A page result contributes itself when it has location data.
- A block result contributes its owning page when that page has location data.
- A block result also contributes any located pages it directly references.
- Query and search hits are not recursively expanded.
- Explicit block-reference collection sources may recursively expand their
  referenced outline.
- Raw `:q` sources should return `?uid`, `?page-uid`, or `?block-uid`; arbitrary
  strings and entity IDs are not guessed.

## Geographic feature model

The first renderer may display only points, but the internal boundary should
accept geometry from the beginning:

```js
{
  pageUid,
  title,
  geometry,
  address,
  groups,
  sourceUids
}
```

This lets point pages, polygons, and future GeoJSON/PMTiles-backed layers share
the source and provenance machinery.

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
new inline parser component. The first implementation task is therefore a live
spike of the exact `{{map}}` render lifecycle.

If a contained DOM observer is required, it is only a mounting signal. Block
UIDs, source definitions, query results, and place data must be read through the
Roam Alpha API. Each visible render is its own instance because one block can
appear in the main window, sidebar, embeds, and block references simultaneously.

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

