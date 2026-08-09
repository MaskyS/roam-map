# Query and Datalog inputs for Roam Map

Status: implemented first version

Evidence and implementation date: 2026-08-09

This note records the product decision, supported authoring forms, live graph
examples, implementation boundaries, and intentional limits for dynamic map
inputs. Native-query block results now have one default interpretation—their
containing page—without adding an author-facing mode. Referenced-page expansion
remains deliberately unsupported.

## Decision

Every dynamic input must produce explicit Roam page or block UIDs. Native-query
page results stay pages, while native-query block results resolve through
Roam's `:block/page` relationship. Datalog results keep exact page or block UID
semantics.

The first version supports two inputs:

1. an ordinary saved native Roam `{{query}}` component, executed by the query
   block's stable UID; and
2. a fenced Datalog code block whose result is a flat UID collection or a
   one-column UID relation.

Both definitions must be direct children of `{{map}}`. Either can instead live
elsewhere and be included by one direct-child block reference.

The implementation does not inspect query-result DOM, rewrite source blocks,
or infer a page referenced by a result block. The native result block UID stays
in provenance even when its containing page becomes the map entity.

## Why native queries use containing pages

Roam's native queries collect matching blocks. In a page-backed location model,
the useful identity is commonly the page that owns those blocks. Mapping the
blocks literally made metadata searches produce markers titled `roam/meta::`,
even though the corresponding Effort page was the durable place entity.

The default rule is therefore:

> A native query page result stays a page; a native query block result maps its
> containing page.

The containing page is a single relationship supplied by Roam, so it gives
stable labels, location lookup, deduplication, and navigation without guessing.
Referenced pages remain ambiguous: one activity block can mention a person,
restaurant, city, project, and event. A daily-note result containing `Went to
[[Restaurant]]` therefore maps the daily-note page, not `[[Restaurant]]`.

If the intended place is a referenced page—or an exact block-backed point—the
Datalog adapter is the explicit escape hatch. Its returned page and block UIDs
continue to map exactly.

This also gives future input methods—search, a public saved-`:q` replay API, or
an extension API—the same output boundary without coupling them to MapLibre.

## Contenders considered

| Roam surface | Strength | Why it is or is not in the first version |
| --- | --- | --- |
| Saved native `{{query}}` | Familiar authoring, Query Builder, boolean/reference clauses, stored filters and sorting | Supported as a convenience adapter; page results stay pages and block results map their containing pages |
| Datalog through `data.async.q` | Precise relationships, dates, namespaces, and explicit result entity | Supported as the general escape hatch through a fenced code block |
| Saved `:q` component | Familiar to graph authors who already save Datalog in `:q` | Not supported because current documentation does not expose a public API to replay a saved `:q` component by UID |
| Page-title search | Fast discovery for names such as Cafes | Deferred; title matching cannot express the relationship and date examples and needs its own completeness/ranking contract |
| Rendered query or search component | Already visible in Roam | Rejected as a data boundary; Roam Map never reads result DOM |
| Raw `{{map: ...}}` argument | Compact | Rejected for now; it hides a substantial source definition inside the component occurrence and conflicts with readable graph blocks |
| Reusable outline | Good for hand-curated collections | Separate feature; a block reference currently targets one query or code definition, not an arbitrary subtree |
| Extension-owned JavaScript callback | Maximum power | Better suited to a future public API than the initial graph authoring surface |

Native query plus Datalog covers a useful progression: start with the familiar
query UI when the matching blocks' containing pages are map entities, then use
Datalog when the graph relationship must select different entities.

## Supported authoring forms

### Native query

```text
{{map}}
  {{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

Roam Map calls the documented native-query API with the query block UID, an
explicit pull pattern, offset zero, and a limit of 250. Query criteria and
query-owned children are claimed as configuration and cannot leak into the
direct source outline.

The component's page results are mapped directly. For block results, the pull
also asks for `:block/page`, and the containing page is mapped. There is no
automatic referenced-page expansion. On the live test page this query returns
`roam/meta::` blocks and maps their containing Effort pages.

### Datalog

````text
{{map}}
  ```clojure
  [:find [?uid ...]
   :where
   [?page :node/title ?title]
   [(clojure.string/starts-with? ?title "[[People]]/")]
   [?page :block/uid ?uid]]
  ```
````

Accepted fence labels are:

- `clojure`
- `clj`
- `datalog`
- `datascript`
- `commonlisp`

The parser requires one complete fenced code block and non-empty query text.
JavaScript and arbitrary prose blocks are not treated as Datalog.

Accepted results are:

```clojure
[:find [?uid ...] ...] ; JavaScript result: ["uid-a", "uid-b"]
[:find ?uid ...]       ; JavaScript result: [["uid-a"], ["uid-b"]]
```

Every value must be a non-empty string UID. Duplicate UIDs are removed while
preserving result order. Scalars, titles, numeric entity IDs, maps, mixed
shapes, and relations with more than one column produce a local diagnostic.

The query executes first; Roam Map then caps the unique UID collection at 250
and pulls those entities in a batch. This is a result and mapping cap, not a
Datalog execution timeout or pre-query database limit.

### Reuse by block reference

```text
{{map}}
  ((saved-dynamic-definition-uid))
```

The reference must be a leaf block directly beneath the map and resolve to
exactly one supported native-query component or fenced Datalog block. Roam Map
watches the original definition UID and retains both the local reference UID
and original definition UID in provenance.

## Use cases

### Located Efforts and People

The live `Roam Map Test` page contains one native-query fixture for Efforts and
one Datalog fixture for People. The Efforts query returns metadata blocks whose
containing Effort pages are mapped; the People query returns exact page UIDs.

Efforts:

```text
{{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

The returned metadata blocks are evidence and provenance; their containing
Effort pages are the feature identities and provide location metadata. People
uses Datalog to return the location pages themselves, rather than blocks that
happen to mention a Person.

### Namespaced places mentioned with a person

A third live fixture exercises an actual relationship rather than a namespace
scan. The public example uses a placeholder Person title:

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

The shared `?mention` variable requires the exact Person and Place pages to be
referenced by one block. Joining that block to a page with `:log/id` restricts
the evidence to a daily note. The returned entity is the Place page, not the
mention block.

In live testing, this high-precision shape returned and mapped namespaced place
pages after those pages had location metadata. A broader query that merely puts
a Person mention and a place on the same daily note can include candidates
without establishing that they share the intended relationship. Same-block
co-occurrence is incomplete, but it avoids silently asserting more than the
graph encodes.

The live page repeats the query shape with another placeholder Person page.
Any page cleanup and Roam Places geocoding remain explicit graph-editing tasks,
not map-rendering side effects.

### Restaurants visited in 2024 or 2025

If `Went to` later becomes a page reference and visit blocks link their exact
restaurant pages, Datalog can join:

- a visit block that references `[[Went to]]`;
- the visit's daily-note page or explicit date;
- a referenced page classified as `[[Restaurants]]`; and
- the restaurant page's stable UID.

The important part is the `:find`: it should return the restaurant page UID,
not the visit block UID. The exact clauses depend on how dates and restaurant
classification are represented in the graph. That graph-specific query can
then feed the map without adding any restaurant-specific logic to Roam Map.

A native query is not enough when it returns visit blocks but the map should
show place pages referenced by them: its default entity is each visit block's
containing page. Datalog must return the restaurant page UIDs explicitly.

### A simple Cafes view

If a native query matches blocks stored on location pages, placing that query
beneath the map is the shortest form because those containing pages are mapped.
If `[[Cafes]]` appears in journal blocks, the native adapter would map the
journal pages; Datalog is clearer because it can return the qualifying cafe
page UIDs explicitly.

A future title-search source could make page-name discovery more concise, but
it would not replace relationship-aware Datalog.

### Block-level points

No separate future identity type is necessary for point blocks. A Datalog
query may return a block UID today. The result maps when the block text is a
valid bare `geo:` URI or the block has a supported `Coordinates` attribute.
The feature remains block-backed, and opening it in the sidebar opens that
source block.

## Execution and lifecycle

Dynamic definitions are classified before direct sources are interpreted. A
successful adapter emits the same contribution structure used by direct page
and block sources, including stable identity, source provenance, and the flag
that permits bare `geo:` parsing for block results. The central compiler then
deduplicates identities and resolves place records.

Each dynamic definition fails independently. One rejected query produces a
diagnostic but does not suppress direct sources or other dynamic sources.

The live session already protects against stale asynchronous compilation by
generation. It watches:

- the map definition and its inline dynamic children;
- an externally referenced dynamic definition;
- returned entities and their known location/presentation attributes; and
- the ordinary option and rendering resources already supported by the map.

A new graph entity can start satisfying arbitrary Datalog or native-query
criteria without changing a currently watched UID. The explicit **Refresh**
action is therefore the correctness mechanism for previously unrelated entities
that enter or leave dynamic membership. A graph-wide polling loop is not added.

## Data, privacy, and extension boundaries

Queries execute against the currently loaded graph through Roam's Alpha API.
Roam Map makes no additional network request for query execution and stores no
copy of the result set outside its in-memory render plan. The code-block query
text and native-query configuration remain ordinary graph data, readable by
people with graph access.

The renderer never rewrites a query, result entity, or location page. Native
query containing pages and exact Datalog result entities become feature records
before MapLibre sees them; query definitions, source provenance, point data,
and MapLibre objects remain separate concerns.

## Diagnostics and limits

The first version reports:

- native-query or Datalog API unavailability;
- execution failures;
- an unexpected native-query response;
- a Datalog result that is not an accepted UID collection;
- a returned UID that no longer resolves to a page or block;
- a native result without a page/block UID;
- a native block result without a containing page; and
- more than 250 returned results.

Native queries ask Roam for the first 250 results. Datalog results are
deduplicated and capped to 250 after execution. Result and diagnostic order
follows source-outline order and then query result order.

## Implementation boundaries

| Concern | File |
| --- | --- |
| Detect definitions, validate Datalog results, execute adapters, and emit contributions | `src/map/dynamic-sources.js` |
| Classify direct-child definitions and references without leaking their contents into direct sources | `src/map/direct-sources.js` |
| Expose bounded native-query and asynchronous Datalog calls | `src/roam/api.js` |
| Merge dynamic reports and contributions into the existing render plan | `src/map/compiler.js` |
| Resolve native containing pages and exact Datalog page/block UIDs as places | `src/map/place-records.js` |
| Replace focused watches and reject stale asynchronous results | `src/map/live-session.js` |

Focused tests cover parsers, accepted and rejected result shapes, API
delegation, native containing-page behavior, Datalog page and block results,
failure isolation, block-reference reuse, criteria-subtree claiming, and
end-to-end compilation through the existing place resolver.

After loading the built extension in Roam Desktop, the live fixtures confirmed
that native-query metadata blocks resolve to mapped Effort pages, Datalog
returns exact People pages, and relationship queries map their returned
namespaced location pages.

## Intentionally deferred

- saved `:q` component replay, pending a documented public UID-based API;
- page-title or semantic search adapters;
- automatic referenced-page expansion;
- raw query text inside `{{map: ...}}`;
- arbitrary referenced source outlines;
- background graph-wide membership polling;
- query-result DOM integration; and
- source-specific domain logic such as “visit,” “restaurant,” or “year.”

## Current Roam documentation used

- [Roam Query](https://roamdocs.fyi/help/query.md)
- [Roam Query Builder](https://roamdocs.fyi/help/roam-query-builder.md)
- [Examples of `:q` query blocks](https://roamdocs.fyi/help/examples-of-q-query-blocks.md)
- [Roam-specific `:q` additions](https://roamdocs.fyi/help/roam-specific-q-additions.md)
- [Datalog block query](https://roamdocs.fyi/developer-documentation/datalog-block-query.md)
- [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api.md)
- [Roam data model](https://roamdocs.fyi/developer-documentation/data-model.md)
- [Blocks](https://roamdocs.fyi/help/blocks.md)
- [Block references](https://roamdocs.fyi/help/block-references.md)
- [Page references](https://roamdocs.fyi/help/page-references.md)
- [`roam/render`](https://roamdocs.fyi/developer-documentation/roam-render.md)

The documentation gate was supplemented with read-only inspection of a local
development graph through Roam's CLI/MCP and live fixtures on `Roam Map Test`.
Roam Map's implementation uses the documented data APIs rather than depending
on the visual implementation of Roam's query components.
