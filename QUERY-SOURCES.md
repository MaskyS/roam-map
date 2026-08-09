# Query sources for Roam Map — design study

Status: historical design study, updated after the first implementation

This document records the reasoning that led to native-query and Datalog
inputs. It deliberately contains no private graph names, block UIDs, personal
identities, note excerpts, or exact result inventories. The implemented
contract is described in
[`QUERY-INPUT-DESIGN.md`](./QUERY-INPUT-DESIGN.md); working authoring forms
belong in [`customization.md`](./customization.md) and
[`examples.md`](./examples.md).

## Evidence base

The design was checked against current Roam documentation and anonymized live
graph experiments:

- [Query](https://roamdocs.fyi/help/query)
- [Roam Query Builder](https://roamdocs.fyi/help/roam-query-builder)
- [Examples of `:q` query blocks](https://roamdocs.fyi/help/examples-of-q-query-blocks)
- [Roam-specific `:q` additions](https://roamdocs.fyi/help/roam-specific-q-additions)
- [Datalog block query](https://roamdocs.fyi/developer-documentation/datalog-block-query)
- [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api)
- [Roam data model](https://roamdocs.fyi/developer-documentation/data-model)

The live experiments established these reusable facts without making their
private source data part of the repository:

| Observed shape | Product implication |
| --- | --- |
| Native reference queries normally return matching blocks | A result adapter must decide how block results become map entities |
| Metadata queries can return structural or attribute blocks beneath location pages | Mapping the containing page produces useful identity, title, navigation, and location lookup |
| Activity blocks on daily notes can mention several pages | Automatically mapping every referenced page is ambiguous |
| Nested namespace titles contribute page references | Namespace pages such as `[[Places]]`, `[[People]]`, and `[[Efforts]]` are useful query handles |
| Text search reaches unlinked prose but also returns incidental matches | Search is useful for discovery but is weaker than queries for deliberate membership |
| Saved native queries execute by stable block UID | A query component can remain the Roam-owned, editable source definition |
| Frontend and backend query surfaces differ for some Roam-specific additions | Date and rule behavior must be tested through the same frontend API the extension uses |
| Current attribute data is not exposed identically by every query surface | Query membership and location resolution should remain separate stages |

## Roam surfaces considered

### Saved native queries

`roamAlphaAPI.data.roamQuery` accepts a saved query block UID and returns
`{total, results}`. Relevant parameters include:

| Parameter | Use |
| --- | --- |
| `uid` | Execute an existing query component and preserve its Roam-owned definition |
| `query` | Execute raw query text; not used by the first map adapter |
| `offset` | Select the first result page explicitly |
| `limit` | Bound the result set instead of accepting the API default |
| `pull` | Request stable UIDs, titles or strings, and the containing page |
| `groupByPage`, `nestUnderParent`, `sort`, `sortOrder` | Query-mode display controls rather than map-specific concepts |

Native query syntax supplies familiar `and`, `or`, `not`, `search`, `between`,
daily-note, and author conditions. The Query Builder edits the real component
block, so graph authors can refine source membership without a second map-only
query language.

### Datalog

`roamAlphaAPI.data.async.q` expresses joins that native queries cannot, such as
requiring the same evidence block to reference both a Person and a Place. It
can also choose the exact result entity in `:find`.

The map adapter intentionally accepts only:

```clojure
[:find [?uid ...] ...] ; flat UID collection
[:find ?uid ...]       ; one-column UID relation
```

Titles, entity IDs, maps, scalars, and multi-column relations are rejected.
This keeps the boundary stable: Datalog chooses the entities, then the ordinary
place resolver determines whether they are mappable.

### Saved `:q` components

Saved `:q` blocks are useful inside Roam, but the current documentation does
not expose a supported API for replaying one by block UID. The first
implementation therefore accepts Datalog text in an ordinary fenced code block
and defers saved-`:q` replay.

### Search

`data.async.search` is a plausible later adapter. It is particularly useful for
unlinked names, but it needs explicit ranking, completeness, page-versus-block,
and result-limit semantics. A `{search: ...}` clause inside a saved native query
already covers part of this use case, so standalone search was not the first
input method.

### Rendered query or search components

Reading rendered result DOM was rejected. Roam Map uses supported data APIs,
stable UIDs, and explicit pull patterns; Roam remains free to change visual
query rendering without breaking map membership.

## The implemented identity decision

The early study considered separate author-facing modes such as `owner-page`,
`referenced-pages`, and `result-block`. Live testing showed that the useful
simple default is narrower:

> A native-query page result stays a page. A native-query block result maps its
> containing page.

The query result block UID remains provenance. The containing page supplies
feature identity, label, location lookup, deduplication, and navigation.

Roam Map does not infer referenced pages. An activity block can mention a
person, restaurant, city, project, and event at once, so selecting all or one
of those references would be a domain-specific guess.

Datalog is the explicit escape hatch:

- return a page UID when the intended place is a referenced page;
- return a block UID when the intended feature is genuinely block-backed; and
- use joins to encode the relationship that makes that entity relevant.

This split also explains why a native query over metadata blocks works well
for `[[Efforts]]`, while visits and relationship questions normally need
Datalog.

## Representative use cases

### Located Efforts

```text
{{map}}
  {{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

The native query returns matching metadata blocks. Roam Map maps their
containing Effort pages and reads location data through the normal page
resolver. Result DOM is not involved.

### Located People

````text
{{map}}
  ```clojure
  [:find [?uid ...]
   :where
   [?page :node/title ?title]
   [(clojure.string/starts-with? ?title "[[People]]/")]
   [?coordinate-block :block/page ?page]
   [?coordinate-block :block/string ?coordinates]
   [(clojure.string/starts-with? ?coordinates "Coordinates::")]
   [?page :block/uid ?uid]]
  ```
````

This query returns exact People page UIDs. The map adapter does not need to
know what `[[People]]` means.

### Namespaced places mentioned with a person

The public example uses placeholders rather than identities from a development
graph:

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

The repeated `?mention` variable requires both references in the same block.
The `:log/id` clause restricts the evidence to a daily note. Most importantly,
the `:find` returns the Place page UID rather than the mention block UID.

### Restaurants visited in a date range

If visit blocks reference `[[Went to]]`, their daily-note page, and a
restaurant page, Datalog can join those relationships and return the restaurant
UID. The classification and date clauses depend on the graph's schema.

A native query that returns visit blocks maps their containing daily-note pages;
it deliberately does not guess which referenced page is the restaurant. This is
why relationship-aware Datalog belongs in the first version.

### A simple Cafes view

If `[[Cafes]]` occurs in metadata blocks stored on cafe pages, a native query
beneath `{{map}}` is concise because those containing pages are the desired
entities. If it occurs in journal mentions instead, Datalog should return the
qualifying cafe page UIDs.

### Block-level points

A Datalog query can return exact block UIDs. A returned block maps when it is a
bare `geo:` block or has the same supported `Coordinates` attributes as a
direct block source. No synthetic page is required.

## Execution and lifecycle conclusions

- Dynamic definitions are direct children of `{{map}}`, or one direct-child
  block reference to a supported definition.
- Native queries execute by saved definition UID with an explicit pull, offset,
  and limit.
- Datalog results are normalized, deduplicated in result order, capped, and
  batch-pulled.
- Each source fails independently and contributes local diagnostics.
- Returned entities and known location dependencies receive focused watches.
- Arbitrary new graph entities can enter a query result without changing a
  watched UID, so explicit **Refresh** remains the completeness mechanism.
- Generation guards prevent stale asynchronous compilation from replacing a
  newer result.
- Rendering never rewrites query definitions, result blocks, or location
  entities.

## Privacy and publication rule

Repository documentation should explain graph shapes without publishing a
development graph's private contents. Use category pages such as `[[Efforts]]`,
`[[People]]`, `[[Cafes]]`, and `[[Restaurants]]` where they clarify the
product. Replace personal page titles with placeholders, omit private note text
and stable graph UIDs, and describe live outcomes qualitatively unless an exact
count is part of a synthetic fixture.

## References

- [Implemented query contract](./QUERY-INPUT-DESIGN.md)
- [Customization reference](./customization.md)
- [Tested examples](./examples.md)
- [Adoption study](./ADOPTION.md)
- [Architecture](./ARCHITECTURE.md)
- [Presentation contract](./PRESENTATION.md)
