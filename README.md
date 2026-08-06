# Roam Map

Roam Map turns ordinary Roam outlines into live maps.

The primary form is a `{{map}}` block whose inline argument and descendants are
place sources. Sources resolve to Roam page UIDs; location data remains ordinary
Roam attributes on those pages.

```text
{{map}}
  [[[[Cafe]]/Artisan Coffee]]
  [[Port Louis]]
```

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

## Product boundary

- Roam is the editor and the durable source of truth.
- `{{map}}` aggregates sources and renders geographic features; it does not
  rewrite source outlines or location pages.
- Roam Places owns place capture. Roam Map owns persistent maps, layers,
  geometry rendering, and map interaction.
- All source forms normalize to page UIDs before location data is read.
- Page UID is identity. Titles are presentation and may change.
- Map state is ephemeral unless the user explicitly saves a view.

## First product-intuition loop

The first milestone is intentionally small:

1. Type or edit a `{{map}}` block and its child page references.
2. See the map mount and update without reloading Roam.
3. See located pages as markers and understand why other inputs were skipped.
4. Click a marker to return to its Roam page.
5. Repeat quickly enough that the outline feels like a map REPL.

Native queries, search components, reusable block-reference collections,
Datalog, named layers, polygons, clustering, and saved presentation settings
build on that loop.

See [DESIGN.md](./DESIGN.md) for the proposed source contract and delivery
sequence.

