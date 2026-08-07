# Composable architecture for Roam Map

Status: technical audit plus first product-loop implementation, current
2026-08-06.

This note develops the source and rendering model in [DESIGN.md](./DESIGN.md).
It asks how Roam Map can stay simple for an ordinary `{{map}}` outline while
remaining capable of accepting coordinates, GeoJSON, tiled sources, and richer
presentation rules later. The design borrows several composition principles
from ProseMirror, but it does not copy ProseMirror's editor transaction system.

The conclusions are based on the current Roam documentation, the existing
Roam Places implementation, the ProseMirror guide, reference manual, examples,
and source, and an independent adversarial review of the proposal. Documented
facts, design choices, and behavior that still needs a live Roam experiment are
identified separately.

## Decisions in brief

1. Keep `{{map}}` as the intended product form. Roam parses it into a default
   component button, but does not document a Depot API for registering a new
   inline `{{name}}` component. The implemented lifecycle adapter confines the
   observed DOM seam to discovery, verifies map semantics through an Alpha API
   pull, and owns replacement and cleanup per visible occurrence.
2. Preserve the direct-page-reference milestone. It is the shortest useful
   edit-render-inspect loop and should be implemented before query adapters or
   a general extension mechanism.
3. Do not normalize every input to a page UID. Page UIDs are the identity of
   page-backed places; they cannot represent a map-local coordinate, an
   unlinked GeoJSON feature, a raster source, or a vector-tile source.
4. Parse source blocks into a small discriminated union. Resolve those values
   into geographic feature records or native map resources. Only then build a
   render plan.
5. Keep the plan free of live MapLibre objects. It may follow MapLibre's useful
   source/layer distinction without pretending to be a complete alternative
   style specification or a promise to support several renderers.
6. Use statically composed first-party modules. A public JavaScript plugin
   registry, transaction filters, appended transactions, and hot plugin
   reconfiguration are deferred until a real use case requires them.
7. Use ordinary Roam outlines, block references, and attributes for authored
   configuration. Use extension settings only for graph-wide defaults. A slash
   command should insert canonical forms rather than introduce a second editor.
8. Treat native queries, search, and `:q` as different source kinds. They have
   different APIs, result shapes, limits, contextual behavior, and invalidation
   rules.
9. Guard every asynchronous compilation with an `AbortSignal` and a generation
   number. Each visible rendering of a map block owns a separate view instance
   and cleanup scope.

## What ProseMirror contributes

ProseMirror is useful here because it makes composition rules explicit. It is
not useful because Roam Map is secretly an editor; it is not. Roam owns the
document, collaborative editing, undo history, and graph transactions.

The [ProseMirror guide's introduction](https://prosemirror.net/docs/guide/#intro)
separates the document model, transformations, state, and view into distinct
modules. That separation is the first lesson to retain:

| ProseMirror concern | Roam Map counterpart |
|---|---|
| document model | a read-only snapshot of the `{{map}}` block and relevant graph entities |
| transform/state boundary | pure parsing, resolving, normalization, and plan-building functions |
| editor view | one React and MapLibre instance for one visible mount |
| plugins | statically composed source parsers, resolvers, and plan helpers |

The comparison stops there. A map refresh is not a Roam edit transaction, and
the extension cannot intercept Roam's transaction stream.

### Small contributions, not subclasses

The [plugin specification](https://prosemirror.net/docs/ref/#state.PluginSpec)
lets a plugin contribute state, view props, transaction hooks, and a view
lifecycle without subclassing the editor. The current
[`plugin.ts` source](https://code.haverbeke.berlin/prosemirror/prosemirror-state/src/branch/main/src/plugin.ts)
shows how little machinery the plugin object itself contains. The surrounding
state and view decide how each contribution is used.

For Roam Map, the transferable principle is that a source parser should parse
sources, a place resolver should resolve page-backed locations, and the
MapLibre boundary should own MapLibre. None should inherit from one large map
controller. Initially these modules should be imported and assembled directly;
there is no need for runtime plugin installation.

### Combination rules are part of the contract

ProseMirror does not use one universal rule when several plugins provide the
same prop. The [guide's section on view props](https://prosemirror.net/docs/guide/#view.props)
and [`EditorView.someProp`](https://prosemirror.net/docs/ref/#view.EditorView.someProp)
describe several behaviors: direct props take precedence, some values use the
first provider, event handlers run until one reports that it handled the event,
and other values are combined.

This matters more than the word “plugin.” Roam Map must state, for every stage,
whether multiple contributions accumulate, override one another, or constitute
an error. Silent last-writer-wins behavior would make a declarative map hard to
reason about.

### Scoped state and lifecycle

A ProseMirror plugin may own a keyed state field and a view object with
`update` and `destroy`; see
[`StateField`](https://prosemirror.net/docs/ref/#state.StateField),
[`PluginView`](https://prosemirror.net/docs/ref/#state.PluginView), and the
current [`state.ts` implementation](https://code.haverbeke.berlin/prosemirror/prosemirror-state/src/branch/main/src/state.ts).
The useful lesson is ownership. State and cleanup belong to the feature and
view instance that created them.

Roam Map does not need a general `PluginKey` implementation. Plain namespaced
fields and explicit object ownership are sufficient. It does need one cleanup
scope that can dispose of React roots, MapLibre maps, observers, pull watches,
requests, resize handlers, and event listeners in reverse registration order.

### Commands as capability checks

A [ProseMirror command](https://prosemirror.net/docs/guide/#commands) receives
state and an optional dispatch function. With no dispatcher it reports whether
the operation applies; with a dispatcher it performs the action. The
[`Command` reference](https://prosemirror.net/docs/ref/#commands.Command) and
[`commands.ts` source](https://code.haverbeke.berlin/prosemirror/prosemirror-commands/src/branch/main/src/commands.ts)
make that convention precise.

Roam Map can retain the capability-check idea without copying the signature.
For a small set of actions, `{ isAvailable(context), run(context) }` is clearer
than a transaction-shaped dispatcher. Refresh, fit, open page, and save view do
not need a universal command protocol in the first version.

### Asynchronous work must rejoin current state

The official [image upload example](https://prosemirror.net/examples/upload/)
starts an asynchronous operation, records a placeholder in plugin state, maps
that placeholder through intervening document changes, and discards completion
when the placeholder no longer exists. Roam Map has a simpler version of the
same problem. A slow query or geospatial source may finish after its source
block changed, after a newer refresh completed, or after the visible map was
removed.

Use a generation number and cancellation rather than a transaction framework:

```ts
const generation = ++instance.generation;
instance.abortController?.abort();
const controller = new AbortController();
instance.abortController = controller;

const result = await compileMap(snapshot, {
  signal: controller.signal,
});

if (
  instance.disposed ||
  generation !== instance.generation ||
  controller.signal.aborted
) return;

instance.apply(result);
```

The generation check remains necessary because not every Roam read or
third-party promise is cancellable.

### ProseMirror mechanisms not adopted

The following mechanisms solve problems that Roam Map does not own:

- A closed document schema. Roam's block and page model is already fixed by
  Roam. The extension validates its own source forms but cannot redefine the
  graph schema.
- `filterTransaction` and `appendTransaction`. Those hooks participate in
  ProseMirror's state transition loop. A map extension has no equivalent
  authority over Roam writes.
- Partially initialized plugin state fields. Their order-dependent behavior is
  a reason to keep Roam Map's stage dependencies explicit, not a feature to
  reproduce.
- Dynamic plugin reconfiguration. Static first-party composition is enough
  until independent extensions genuinely need to add source or layer types.

## Roam's documented constraints and useful native surfaces

### Extension lifecycle

The [Roam Depot Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api)
defines `onload`, an optional returned cleanup function, and `onunload`.
Commands, the settings panel, and extension CSS are removed automatically.
DOM nodes, observers, event listeners, timers, and other resources are not.
That makes complete per-instance disposal a correctness requirement, not an
optional refinement.

The same page documents two useful authoring surfaces:

- a slash command can return text to insert at the cursor and receives the
  focused block UID and replacement indexes;
- extension settings provide graph-synced, JSON-serializable defaults, subject
  to `settings.canSet` when a graph administrator installed the extension for
  everyone.

Settings are appropriate for a default map style, default height, or a
graph-wide result cap. Per-map sources, layers, and saved views belong in the
outline so that they remain visible, referenceable, and exportable.

### React and Blueprint are already present

Roam's [Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries)
page currently lists React 18.2.0 as `window.React`, matching React DOM globals,
Blueprint Core, Select, and DateTime, and several other synchronous and lazy
libraries. Roam Map should externalize these packages and verify that the
production bundle does not contain a second React runtime. MapLibre is not on
that list and remains an extension dependency.

### The bare `{{map}}` mounting seam is not documented

Roam documents inline custom components through
[`roam/render`](https://roamdocs.fyi/developer-documentation/roam-render). Its
invocation is `{{roam/render: ((code-block-uid)) ...}}`, and its JavaScript/JSX
context includes the host block UID. Roam also documents full-window custom
React components through `roamAlphaAPI.ui.mainWindow.registerComponent` on the
[Alpha API page](https://roamdocs.fyi/developer-documentation/roam-alpha-api).

Neither page documents a Depot method that registers `map` as a new inline
parser token. Therefore:

- parsing `{{map}}` is now an observed client fact, but extension-controlled
  mounting for it is not a documented integration contract;
- `roam/render` is a supported fallback or prototyping route, although its
  syntax is less attractive and may require a graph-resident entry block;
- `registerComponent` is suitable for a later maximized main-window map, not
  for the initial inline form;
- if a contained DOM observer is necessary, it may discover mount candidates
  only. Semantic data must still come from the Alpha API, never from rendered
  query results or DOM text.

A live Roam Desktop test adds useful evidence without turning the DOM into a
supported API. On a disposable page, all three tested strings—`{{map}}`,
`{{[[map]]}}`, and `{{map: all}}`—rendered as a default button whose relevant
markup was:

```html
<button
  class="bp3-button bp3-small dont-focus-block rm-xparser-default-map"
  data-roamjs-smartblock-button="true"
>map</button>
```

Clicking the button did not invoke a component and logged `no component` in the
client console. The argument `all` was not present in the button markup. The
containing rendered block did expose a `data-block-uid`, from which the exact
block string was recovered with `roamAlphaAPI.data.async.pull`. This is a
plausible discovery seam: an observer can find `.rm-xparser-default-map`, add an
extension-owned sibling or replacement root, and use the UID only to begin an
Alpha API read. The class name, `data-roamjs-smartblock-button`, ancestor
layout, and console message are undocumented implementation details. None may
be treated as a permanent extension contract.

Runtime inspection also matched the documented API boundary. In that client,
`roamAlphaAPI.ui.components` exposed `renderBlock`, `renderPage`,
`renderString`, `renderSearch`, and `unmountNode`; it exposed no registration
method. The rendering helpers cannot be reinterpreted as an inline-component
registry.

`{{[[map]]}}` also creates the ordinary page-reference semantics implied by
`[[map]]`; it is not merely an alternate spelling. The bare `{{map}}` form
should remain canonical unless linking a `map` page is an intentional product
choice.

The older [iFrame Components](https://roamdocs.fyi/developer-documentation/iframe-components)
surface is explicitly marked deprecated and exposes a narrower message-based
graph interface. It should not become the fallback architecture for a new
Depot extension.

The same test rendered one map definition simultaneously in the main window
and right sidebar. Roam created separate fallback-button nodes for both views.
A block reference rendered the referenced map again, but its DOM carried two
identities: the closest rendered block belonged to the block containing the
reference, while `.rm-block-ref[data-uid]` identified the referenced definition
block. This confirms that a single definition may have several visible views
and that reference-host identity cannot replace definition identity. Embeds
and query results remain to be tested.

### Graph identity and references

The [Roam data model](https://roamdocs.fyi/developer-documentation/data-model)
states that pages and blocks have stable `:block/uid` values, while numeric
`:db/id` values should not be persisted across export and import. It also says
that page links, tags, attributes, and block references create `:block/refs`
datoms and explicitly advises checking references rather than parsing strings.

Use the two representations together:

- inspect the block string to recognize a source form and preserve outline
  order;
- use pulled `:block/refs` and entity attributes to resolve the referenced
  page or block identity;
- never retain `:db/id` as source or feature identity;
- do not treat every reference in a query component as a direct page source.
  The query parser claims that block before the direct-reference parser runs.

[Block references](https://roamdocs.fyi/help/block-references) are a natural
way to reuse source or style outlines. Expansion should occur only in an
explicit source or style context, retain the referencing block in provenance,
and detect cycles by block UID. An arbitrary reference elsewhere in a map
definition should remain an ordinary input, not trigger recursive expansion.

### Current and compatibility attributes

The [current attributes model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new)
represents each `Name:: value` assertion as a derived HARC entity. The source
blocks remain the writable representation. In particular:

- `:harc/e` is the described entity;
- `:harc/a` is the attribute page;
- `:harc/v` contains page, block, or owned text value entities;
- `:harc/*-source` records provenance;
- a block whose text is exactly `roam/meta::` is a structural proxy, so
  attributes beneath it describe its parent rather than the metadata block.

The [compatibility attributes model](https://roamdocs.fyi/developer-documentation/attributes-data-model)
uses `:entity/attrs` with `:attrs/lookup`. Under that representation, metadata
children may attach to the `roam/meta::` block rather than its parent. Roam
Places already isolates these two read paths in its place-data boundary and
writes only ordinary attribute blocks. Roam Map should follow the same rule:

- never write `:harc/*`, `:entity/attrs`, or `:attrs/lookup` directly;
- read both representations when they are available, rather than stopping as
  soon as one produces a value;
- select a complete, valid current HARC coordinate as authoritative; use a
  complete, valid compatibility coordinate only when HARC has no usable value;
- when both representations produce usable values, compare their normalized
  coordinates and report disagreement while retaining the HARC value;
- resolve a legacy direct `roam/meta::` child back to its parent page;
- treat zero latitude or longitude as valid;
- report absent values, malformed values, conflicts within one representation,
  and disagreement between representations separately.

The page resolver is one resolver, not the universal data model. Map-local
points need not create pages merely to pass through it.

### Queries, search, and `:q` are not interchangeable

The Alpha API documents three distinct mechanisms:

1. `roamAlphaAPI.data.roamQuery` executes native `{{query}}` syntax. It accepts
   either an existing query block UID or a query string and returns
   `{ total, results }`. Query mode defaults to a limit of 20 unless the caller
   supplies another limit.
2. `roamAlphaAPI.data.async.search` returns ranked page and block matches and
   accepts its own result limit and pull pattern.
3. `roamAlphaAPI.data.async.q` executes DataScript/Datalog and returns tuples
   according to the query's find specification.

The user-facing [Query](https://roamdocs.fyi/help/query) documentation says
native queries do not rerun automatically by default. A user can refresh them
or enable the native Reactive option. The
[Query Builder](https://roamdocs.fyi/help/roam-query-builder) edits the actual
query syntax in the block, which makes a child native query a good reusable
source definition.

[`:q` examples](https://roamdocs.fyi/help/examples-of-q-query-blocks) show
scalar and relation results, and explain that variables containing `uid` gain
special display behavior. The
[Roam-specific `:q` additions](https://roamdocs.fyi/help/roam-specific-q-additions)
include contextual symbols such as `current/block-uid` and
`current/main-window-page-uid`. Executing copied query text outside the original
component may change or remove that context. Until a live test defines it, the
map adapter should reject contextual `current/*` symbols or require an explicit
context contract.

Pull watches do not close this gap. `roamAlphaAPI.data.addPullWatch` watches one
pattern on one entity and fires with before/after pulls, with roughly 100 ms
debouncing. It can watch the map definition and each resolved place page. The
documentation does not provide a subscription to the result set of an
arbitrary query or search. Manual refresh is therefore the honest first policy
for dynamic source membership.

## Proposed data flow

The word “compile” is useful because each stage produces a value and can emit
diagnostics. It does not imply that Roam exposes a formal grammar for every
component spelling.

```text
Roam block snapshot
  -> map definition parser
  -> source loaders
  -> typed input items
  -> input resolvers
  -> feature records and native resources
  -> normalization and logical layers
  -> render plan
  -> one MapLibre adapter
```

The first milestone uses only a subset:

```text
map block + direct page-reference children
  -> page inputs
  -> Roam Places attribute resolver
  -> one GeoJSON FeatureCollection + diagnostics
  -> one MapLibre map
```

The stage boundaries should exist as ordinary functions. Do not build a plugin
manager before the second parser or resolver exists.

### Parsed definitions and typed inputs

The parser records source identity and context before doing asynchronous work:

```ts
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import type { SourceSpecification } from "maplibre-gl";

type GeoFeature = Feature<Geometry, GeoJsonProperties>;

type Origin = {
  mapBlockUid: string;
  sourceBlockUid: string;
  sourceKind: string;
  groupPath: string[];
};

type InputItem =
  | { kind: "roam/page"; uid: string; origin: Origin }
  | { kind: "roam/block"; uid: string; origin: Origin }
  | {
      kind: "geo/point";
      coordinates: { latitude: number; longitude: number; altitude?: number };
      properties: Record<string, unknown>;
      origin: Origin;
    }
  | { kind: "geo/feature"; feature: GeoFeature; origin: Origin }
  | {
      kind: "maplibre/source";
      id: string;
      source: SourceSpecification;
      origin: Origin;
    };
```

`roam/block` is distinct from `roam/page` because query and search results may
return either. A later result resolver can apply an explicit product policy to
block hits. It should not smuggle that policy into every source loader.

The `maplibre/source` member is an eventual advanced route, not a first-release
requirement. It prevents the type design from assuming that tiled or raster
data can be converted cheaply to a local feature collection.

These imports are part of the implementation contract, not a claim that the
snippets already form a complete module. Pin the GeoJSON and MapLibre types to
the package versions selected by the project. Validation must reject a GeoJSON
feature with null geometry before it becomes `GeoFeature`; supplied GeoJSON IDs
may be strings or numbers and are normalized into the string identity described
below.

### Feature records and identity

Resolvers emit data records, not markers or MapLibre objects:

```ts
type FeatureRecord = {
  id: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
  roam?: { pageUid?: string; blockUid?: string };
  memberships: string[];
  provenance: Origin[];
};
```

Identity rules must be explicit:

- a page-backed single geometry uses the page UID;
- if one page can own several geometries, identity is `pageUid + geometryKey`;
- one map-local point in one Roam block uses the source block UID;
- if one block owns several items, persistent identity requires an explicit
  item ID; an index-derived ID is snapshot-local and must not retain selection
  or saved presentation state across insertion or reordering;
- a GeoJSON feature with an ID uses `sourceBlockUid + String(feature.id)` so
  IDs from separate sources cannot collide; an id-less feature may receive a
  snapshot-local index-derived ID, accompanied by the same stability warning;
- native sources use an explicit source ID;
- titles and coordinate equality are never identity.

When the same feature arrives through several sources, deduplication merges
memberships and provenance. It does not discard the later paths. Two unrelated
features at the same coordinates remain distinct.

### A deliberately small render plan

MapLibre's [source specification](https://maplibre.org/maplibre-style-spec/sources/)
separates data from presentation. Its
[layer specification](https://maplibre.org/maplibre-style-spec/layers/) lets
several layers filter and style one source. Roam Map should preserve that
useful distinction.

The initial plan can remain small:

```ts
type RenderPlan = {
  collections: Array<{
    id: string;
    data: FeatureCollection<Geometry, GeoJsonProperties>;
  }>;
  layers: Array<{
    id: string;
    title: string;
    sourceId: string;
    geometryKinds: Geometry["type"][];
    visible: boolean;
    style: LogicalStyle;
  }>;
  initialView: "fit" | SavedView;
  controls: ControlSpec[];
  attribution: Attribution[];
  diagnostics: Diagnostic[];
};
```

This is an application plan, not a replacement for the MapLibre Style
Specification. The adapter may compile logical styles to circle, symbol, line,
or fill layers and may add clustering. A later advanced escape hatch can add
validated native sources and layers without weakening the ordinary path.

Only the adapter may call `new Map`, `addSource`, `addLayer`, `setData`, attach
MapLibre handlers, or call `map.remove()`. That rule keeps tests independent of
WebGL and prevents source parsers from retaining renderer state.

## Composition rules

These rules are part of the design, not implementation trivia.

| Concern | Rule |
|---|---|
| source recognition | The most specific recognized form claims the block. A tie at the same specificity is an ambiguity diagnostic, not silent parser order. |
| source results | Concatenate in outline order and retain each origin. |
| input resolution | Select exactly one resolver by `InputItem.kind`; a missing resolver is a diagnostic. |
| feature deduplication | Merge only by the explicit identity rules above; collect memberships and provenance. |
| diagnostics | Accumulate and deduplicate by a stable diagnostic key. Never let one source failure hide successful sources. |
| options | Resolve each declared option independently by scope. Do not use a generic deep merge. |
| source and layer IDs | Duplicate IDs are errors unless an option explicitly declares an override policy. |
| asynchronous completion | The latest live generation may commit. Earlier or disposed generations are ignored. |
| cleanup | Dispose in reverse ownership/registration order. Cleanup is idempotent. |

There is intentionally no general event-hook rule in the first architecture.
Map interactions remain explicit adapter code. If an external contribution API
is added later, handler ordering and “handled” semantics must be specified then.

## Roam-native authoring forms

The forms below are proposals. Except where linked to Roam documentation, they
are not existing Roam syntax.

### Direct pages remain the easiest case

```text
{{map}}
  [[[[Cafe]]/Artisan Coffee]]
  [[Port Louis]]
```

For the first milestone, one direct-page source block must contain exactly one
complete page-link expression after surrounding whitespace is removed. A
balanced delimiter scanner identifies the outer expression, so the nested page
title `[[Cafe]]/Artisan Coffee` is not mistaken for two top-level inputs. The
parser rejects trailing prose and multiple top-level page links with an
ambiguity diagnostic; a later explicit “all references” source may support
those forms if they prove useful.

The scanner extracts the exact outer page title. The Alpha API then resolves
that title to a page entity, and the pulled `:block/refs` collection confirms
the stable UID. The implementation must not take the first member of
`:block/refs`: it is a collection, may include pages referenced inside a nested
title, and does not encode syntactic occurrence order. No match, more than one
possible outer target, or a mismatch between parsed syntax and graph references
is a source diagnostic. The page resolver then reads location attributes. The
title is presentation and is not retained as identity.

### Coordinates need an unambiguous easy form

A naked pair such as `-20.1609, 57.5012` is unsafe because coordinate order is
not evident. Two forms are preferable.

For a concise point, accept the standard `geo:` URI:

```text
{{map}}
  geo:-20.1609,57.5012
```

[RFC 5870](https://www.rfc-editor.org/rfc/rfc5870.html#section-3.3) defines the
order as latitude, longitude and defaults to WGS84. The parser should reject
non-finite numbers, latitude outside `[-90, 90]`, and longitude outside
`[-180, 180]`. The first adapter should accept only two-dimensional WGS84
locations, with either no `crs` parameter or `crs=wgs84`. It must reject an
unsupported CRS rather than silently reinterpret it. An uncertainty parameter
may be preserved as feature metadata; altitude and other parameters can wait
until their semantics are implemented explicitly.

For a named, extensible point, ordinary Roam attributes are more natural:

```text
{{map}}
  Port Louis Waterfront
    Latitude:: -20.1609
    Longitude:: 57.5012
```

In the current HARC model those attributes describe the parent block. That
block becomes the stable identity and provenance for a map-local feature. It
can later gain a label, URL, category, accuracy, or other properties without
being promoted to a page.

Internally, both forms become the same `geo/point` value. At the GeoJSON
boundary the order changes to longitude, latitude, as required by
[RFC 7946 section 3.1.1](https://datatracker.ietf.org/doc/html/rfc7946#section-3.1.1).
Types and field names should make that conversion impossible to overlook.

### GeoJSON is the advanced feature escape hatch

A future adapter can accept a fenced JSON block in an explicit context:

````text
{{map}}
  GeoJSON
    ```json
    {"type":"FeatureCollection","features":[...]}
    ```
````

This route should validate RFC 7946, size limits, geometry types, feature IDs,
and properties before creating records. It should not execute JavaScript. Raw
GeoJSON is valuable, but it should follow the direct-page and direct-coordinate
proofs rather than delay them.

### Queries remain ordinary child components

```text
{{map}}
  Cafes
    {{[[query]]: {and: [[Cafe]] {not: [[Closed]]}}}}
  Coffee search
    {{[[search]]: coffee Mauritius}}
```

The group blocks supply layer membership and a readable label. The query block
is executed with `roamQuery({ uid })` so that its stored native settings can be
respected where the API supports them. Search text is passed to
`data.async.search`. Neither adapter reads the displayed results from the DOM.

`{{map: {and: ...}}}` can remain shorthand for one native-query source. Its
balanced braces require a real delimiter scanner; a single regular expression
will fail on nested clauses.

### Reusable outlines require an explicit context

```text
{{map}}
  Sources
    ((source-outline-uid))
  Style
    ((style-outline-uid))
```

The surrounding block tells the parser whether to expand the reference as
sources or options. Expansion preserves origin information and detects cycles.
This is less surprising than recursively expanding every block reference found
under a map.

### Options should stay readable

Per-map options can be ordinary attributes under an `Options` block:

```text
{{map}}
  [[Port Louis]]
  Options
    Map/Height:: 420
    Map/Initial view:: fit
    Map/Result limit:: 200
```

Namespaced attribute pages reduce collisions with unrelated `Height` or
`Limit` attributes. A reusable options block can be brought in by block
reference. A slash command can insert the canonical outline and help users
discover valid options.

Each option definition should declare its own behavior:

```ts
type OptionDefinition<T> = {
  key: string;
  scopes: Array<"graph" | "map" | "group" | "layer" | "item">;
  defaultValue: T;
  parse(value: unknown): T | Diagnostic;
  validate(value: T): Diagnostic[];
  inherit(parent: T, local: T | undefined): T;
  serialize(value: T): string;
};
```

The precedence is graph default, referenced preset, map, group/layer, then
item. “Later wins” applies only when that option's `inherit` function says so.
Lists, filters, and attribution may need accumulation instead.

An explicit Save view action may write a namespaced view outline under the map
block. Ordinary panning and zooming stay ephemeral, and a source refresh must
not reset the camera after the user has started navigating.

### Projecting feature data for native presentation

Roam attribute projection is a data concern, not a presentation-option type.
For a page-backed feature, the public property key should be the readable
attribute page title:

```js
properties: {
  "Profile Picture": "roam-map:image:abc123",
  "Population": 1200000,
  "roam/pageUid": "stable-page-uid"
}
```

The compiler resolves and retains each attribute page UID internally for
current HARC reads, compatibility reads, pull watches, and provenance. Users
author `Profile Picture`, not an opaque UID, a generated
`profilePictureImage` alias, or a new `roam-attr(...)` expression. Attribute
page titles are unique within a graph, readable six months later, and portable
between graphs. Compiler-owned properties reserve the `roam/` prefix.

The initial experiment should project suitable scalar attributes already
available in the page pull and measure the resulting GeoJSON size and
invalidation behavior. Static analysis of native layer expressions can provide
missing-attribute and type diagnostics. Demand-driven projection remains an
implementation option if measurements justify the complexity of correctly
walking `get`, `has`, object access, dynamic keys, filters, and future MapLibre
expressions.

Presentation after that boundary is native MapLibre:

- a literal supplies the same value to every feature;
- `get` reads a per-feature property such as `Profile Picture`;
- `global-state` reads a map-wide value set through the MapLibre API; and
- `case`, `coalesce`, `match`, and `interpolate` compose those values.

A population attribute still needs an explicit native scale before it can
sensibly control marker radius. Profile pictures are therefore a fixture for
generic feature projection and runtime assets, not a built-in people mode.

Images require a separate asset lifecycle. The compiler can produce an image
descriptor and opaque runtime value, while the MapLibre boundary retrieves
supported Roam files, decodes and optionally transforms them, registers them
with the active style, restores them after `setStyle`, and cancels stale work.
The normal portrait presentation is a base circle layer plus a filtered symbol
layer, so a missing image cannot make the mapped person disappear.

Marker shape and size should normally remain MapLibre concepts:

- a `circle` layer plus `circle-radius` defines a circular point in pixels;
- a `symbol` layer plus `icon-image` uses a registered image, whose visible
  size is scaled by `icon-size`;
- a square, triangle, pin, or other icon is an image resource, not another
  closed `marker-shape` enum;
- clipping an arbitrary portrait into a circle is not a MapLibre style
  property. Roam Map may provide optional image preprocessing or an HTML
  `Marker` helper, but that helper must remain visibly separate from the native
  layer specification.

The same resolver should feed MapLibre resources. `map/style` can take a style
URL directly or refer to a reusable block containing a validated MapLibre style
specification. Separate source and layer definitions can extend that style.
The current `map/basemap:: streets|satellite` switch is a bounded live
experiment, not the long-term model: it cannot express a third provider, a
raster overlay, labels over imagery, or a user-authored style. Named presets
may remain as conveniences if they compile to the same ordinary MapLibre
style/source/layer inputs.

The complete concept walkthrough, expression semantics, image fallback rules,
and future-agent verification checklist are in
[PRESENTATION.md](./PRESENTATION.md).

## Query result semantics are a product decision

Roam's APIs return pages, blocks, or tuples. They do not define which geographic
entity a map should infer from a block result. Several plausible policies exist:

- map the block's owning page when that page is located;
- map located pages directly referenced by the block;
- map both;
- accept only page UIDs and report all other results as unsupported.

The current design's “owner plus direct references” rule is broad and may map
unrelated places. A block on a located page can also reference another located
page, and native query matching may inherit references from ancestors that do
not appear directly in the result string.

The first query adapter should retain the raw result entity and expose counts
for each normalization step. A source-level result mode can be added after live
fixtures establish a useful default. Until then, do not silently combine owner
and reference candidates. Diagnostics should distinguish:

- returned entities;
- page candidates;
- directly referenced candidates;
- mapped features;
- candidates skipped for missing or invalid location data;
- truncation and query failure.

Raw `:q` should require an explicit UID-producing contract such as `?uid`,
`?page-uid`, or `?block-uid`. Do not guess from arbitrary strings or persist
numeric entity IDs.

## State, invalidation, and view ownership

### Definition, host, and view identities are different

The durable definition is identified by the UID of the block whose own string
contains the map component. A direct rendering normally has the same definition
and host UID. A block-reference rendering does not: the definition UID belongs
to the referenced block, while the host UID belongs to the block containing the
reference. A visible instance also needs a generated mount identity because
either block can itself appear more than once:

```text
definition identity = UID of the block containing the map definition
host identity       = UID of the block hosting this rendered occurrence
view identity       = definition UID + host UID + generated mount ID
```

For the observed block-reference form, the closest `[data-block-uid]` identified
the host block and `.rm-block-ref[data-uid]` identified the referenced
definition. Those selectors are discovery evidence, not supported data APIs;
the extension must confirm either UID and read its string through the Alpha
API. Compiled snapshots may be cached by definition UID and revision. React
roots, MapLibre objects, container sizes, current camera state, observers, and
event handlers belong to the visible instance. Two views of the same definition
must not destroy or resize each other.

### A small event model is sufficient

Typed events can make asynchronous transitions testable without claiming Roam
transaction semantics:

```ts
type InstanceEvent =
  | { type: "definition-invalidated" }
  | { type: "refresh-requested" }
  | { type: "compile-started"; generation: number }
  | { type: "compile-succeeded"; generation: number; plan: RenderPlan }
  | { type: "compile-failed"; generation: number; diagnostics: Diagnostic[] }
  | { type: "disposed" };
```

A reducer is optional. The important constraint is that state changes flow
through one instance controller and stale generations cannot mutate the view.

### Focused watches, not graph-wide reactivity

Use pull watches for the map definition subtree and for the currently resolved
page-backed places. When results change, remove watches for pages that left the
set and add watches for new pages. Store the exact pattern, entity lookup, and
callback identity used for each registration so removal is precise.

Query, search, and Datalog membership should begin with explicit refresh.
Watching the query block detects definition changes, not every graph edit that
could change its result. A graph-wide observer would be expensive and would
still need dependency analysis to be correct.

## Extensibility without premature public plugins

There are three distinct levels of extensibility:

1. **Declarative inputs and options.** Page refs, `geo:` points, block-backed
   points, GeoJSON, logical styles, and validated native resources cover most
   customization without code.
2. **First-party modules.** Parsers and resolvers are small typed functions
   assembled statically by Roam Map. This is enough to keep the implementation
   composable and independently testable.
3. **External JavaScript contributions.** A public registry would require API
   versioning, ownership, unloading, duplicate ID rules, dependency handling,
   recompilation of mounted maps, and failure isolation.

Roam currently documents extension lifecycle APIs, but not cross-extension
imports or a shared extension registry. A global such as
`window.roamMap.registerContribution` is technically possible in one browser
page, yet it would be an extension-owned convention rather than a Roam-native
contract. Defer it. The declarative GeoJSON and MapLibre escape hatches should
be attempted first because they survive export and do not execute arbitrary
extension code.

If external contributions are later justified, freeze a small versioned
contract and retain the composition rules in this document. Registration
should fail on duplicate IDs, cleanup should run in reverse registration
order, and one failing contribution should become a diagnostic rather than
break unrelated sources.

## Feasibility audit

| Proposal | Verdict | Reason |
|---|---|---|
| `{{map}}` plus child outline as the authoring surface | Confirm the form; keep the mount provisional | Live Roam produces a recognizable default component button, but registration and lifecycle remain undocumented. |
| typed page, block, coordinate, and feature inputs | Confirm | This removes the page-UID bottleneck without weakening the direct-page path. |
| page UID as identity for page-backed places | Confirm | It follows Roam's stable identity model; titles remain presentation. |
| page UID as the universal intermediate representation | Reject | Coordinates, GeoJSON, raster, and tile sources do not have natural page UIDs. |
| provenance and group membership retained through deduplication | Confirm | Required for legends, inspection, and predictable multi-source behavior. |
| source adapters from the first commit | Revise | Define the union now; introduce adapter objects only as distinct source implementations appear. |
| general transform registry | Defer | Pure functions are sufficient until two independent transform providers exist. |
| small render plan and one MapLibre boundary | Confirm | It isolates WebGL lifecycle and keeps compilation testable. |
| complete renderer-neutral style language | Reject | MapLibre is the chosen renderer; duplicating its style specification adds no present value. |
| ProseMirror-style plugin manager and keyed state | Defer | Explicit modules and per-instance fields solve the current problem with less machinery. |
| transaction filters and appended transactions | Reject | Roam Map does not own Roam's edit transaction loop. |
| typed instance events and latest-generation commits | Confirm | They address real asynchronous and lifecycle races. |
| universal dry-run command signature | Reject initially | Separate applicability predicates and actions are clearer for the small command set. |
| native query, search, and `:q` behind one undifferentiated adapter | Reject | Their documented contracts and contextual semantics differ. |
| public JavaScript contribution API | Defer | No demonstrated requirement or documented Roam cross-extension mechanism exists yet. |

## Delivery sequence and implementation status

The first-loop issues were implemented together on
`codex/ready-product-loop` because each one makes the next one testable:

1. [#1](https://github.com/MaskyS/roam-map/issues/1) proves or rejects the
   inline lifecycle assumption.
2. [#2](https://github.com/MaskyS/roam-map/issues/2) establishes a cleanup-safe
   extension and build harness using Roam's React globals.
3. [#3](https://github.com/MaskyS/roam-map/issues/3) becomes the page-backed
   location resolver, including current HARC, legacy attributes,
   `roam/meta::`, invalid data, and zero-coordinate fixtures.
4. [#4](https://github.com/MaskyS/roam-map/issues/4) is the first source parser:
   direct descendant page references.
5. [#5](https://github.com/MaskyS/roam-map/issues/5) builds the minimal plan and
   renders one GeoJSON source through the MapLibre adapter.
6. [#6](https://github.com/MaskyS/roam-map/issues/6) adds focused watches,
   generation guards, and complete instance disposal.
7. [#7](https://github.com/MaskyS/roam-map/issues/7) exposes counts,
   diagnostics, refresh, fit, and page navigation.

After that loop works, add one direct-coordinate issue before the query family.
It is the smallest proof that the typed input boundary is real rather than
documentation. Then proceed to reusable outlines
([#8](https://github.com/MaskyS/roam-map/issues/8)), native queries
([#9](https://github.com/MaskyS/roam-map/issues/9)), search
([#10](https://github.com/MaskyS/roam-map/issues/10)), and explicit UID-producing
`:q` ([#11](https://github.com/MaskyS/roam-map/issues/11)). Named layers,
geometry, options, and saved views should follow observed needs from those
sources rather than precede the product loop.

The resulting vertical slice now includes the lifecycle and build harness,
current and compatibility place resolution, ordered descendant page sources,
a persistent point renderer, focused pull watches with stale-generation
guards, and visible counts, diagnostics, refresh, fit, selection, and page
navigation. Query, search, and `:q` inputs remain deliberately unimplemented;
the parser reports an inline argument instead of pretending to execute it.

Raw GeoJSON, validated native MapLibre resources, and a public contribution API
deserve separate later issues. They should not be folded into the first point
renderer.

## Verification checkpoint

On 2026-08-06 the production extension was loaded as a local-folder developer
extension in Roam Desktop. Bare, linked, inline-argument, and block-reference
map occurrences each produced an independent React/MapLibre view on the same
page. The OpenFreeMap basemap loaded, attribution remained visible, and empty or
unsupported sources produced local guidance rather than breaking sibling map
instances. This verifies the actual mount and WebGL seam; it does not convert
the fallback-button DOM class into a supported Roam API.

The automated suite exercises parser nesting, current HARC and compatibility
attributes, exact `roam/meta::`, invalid and zero coordinates, source ordering,
deduplication and provenance, block-reference identity, duplicate mounts,
latest-generation commits, pull-watch diffing and removal, persistent map data
updates, initial-only fitting, and complete runtime cleanup. The production
bundle guard requires one MapLibre license marker, rejects React runtime
signatures, and caps the artifact size.

## Live experiments still required

The implementation and first live load reduce, but do not eliminate, the
experiments around Roam's undocumented inline seam. The remaining experiments
are:

1. Record mount replacement behavior while repeatedly entering and leaving
   edit mode.
2. Repeat the duplicate-view test in an embed and a query result. Confirm that
   each visible occurrence receives a distinct mount and that definition and
   host UIDs are recovered correctly.
3. Complete a live cleanup matrix covering navigation, collapse, removal,
   extension reload, disable, graph switch, and React remount. Automated tests
   already cover DOM removal and extension-owned cleanup paths.
4. Test whether `roam/render` can provide a stable fallback from a Depot
   extension without writing an unsafe bootstrap into the user's graph.
5. Capture real Roam Places pages under current HARC, legacy attributes,
   top-level attributes, and `roam/meta::`; compare them with the synthetic
   resolver fixtures now in the test suite.
6. Exercise recursive pull watches live on source insertion, deletion,
   reordering, and string edits. Exact callback-pattern-entity removal and
   stale-generation behavior are already covered by automated tests.
7. Test `roamQuery({ uid })` with default and explicit limits, grouping,
   nesting, sorting, and the native Reactive setting. Determine which settings
   affect returned data rather than only display.
8. Test search component spellings and confirm that the query string can be
   recovered without relying on internal `:block/props`.
9. Test each relevant `current/*` symbol when `:q` text is executed through the
   frontend API away from its rendered block.
10. Extend the successful Roam Desktop basemap and attribution test to the web
    client and supported mobile clients; verify resize and live
    `map.remove()` cleanup in each environment.

## Primary references

### Roam

- [Roam Depot Extension API](https://roamdocs.fyi/developer-documentation/roam-depot-extension-api) — lifecycle, settings, command palette, and slash commands.
- [Roam Depot extensions](https://roamdocs.fyi/developer-documentation/roam-depot-extensions) — packaging and extension expectations.
- [Roam Alpha API](https://roamdocs.fyi/developer-documentation/roam-alpha-api) — async reads, `roamQuery`, search, pull watches, rendered Roam components, focus, sidebars, and main-window components.
- [Roam data model](https://roamdocs.fyi/developer-documentation/data-model) — stable UIDs, block/page entities, references, pulls, and query performance guidance.
- [Current attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model-new) — HARC entities, source provenance, value forms, and `roam/meta::`.
- [Compatibility attributes data model](https://roamdocs.fyi/developer-documentation/attributes-data-model) — `:entity/attrs` and `:attrs/lookup`.
- [`roam/render`](https://roamdocs.fyi/developer-documentation/roam-render) — documented inline custom-component syntax and context.
- [Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries) — React 18.2.0, React DOM, Blueprint, and other globals.
- [Query](https://roamdocs.fyi/help/query) and [Roam Query Builder](https://roamdocs.fyi/help/roam-query-builder) — native syntax, display options, refresh, and Reactive behavior.
- [Examples of `:q` query blocks](https://roamdocs.fyi/help/examples-of-q-query-blocks) and [Roam-specific `:q` additions](https://roamdocs.fyi/help/roam-specific-q-additions) — result forms, UID conventions, rules, and contextual symbols.
- [Block References](https://roamdocs.fyi/help/block-references) — reusable blocks and reference behavior.
- [Roam documentation index](https://roamdocs.fyi/llms.txt) — current machine-readable index and Markdown mirrors.

### ProseMirror

- [Guide](https://prosemirror.net/docs/guide/) — model, state, transactions, plugins, view props, data flow, and commands.
- [Reference manual](https://prosemirror.net/docs/ref/) — `PluginSpec`, `StateField`, `PluginView`, `EditorView.someProp`, transactions, and commands.
- [ProseMirror repositories](https://code.haverbeke.berlin/prosemirror/) — current primary source host.
- [`prosemirror-state` plugin source](https://code.haverbeke.berlin/prosemirror/prosemirror-state/src/branch/main/src/plugin.ts) and [state source](https://code.haverbeke.berlin/prosemirror/prosemirror-state/src/branch/main/src/state.ts).
- [`prosemirror-view` source](https://code.haverbeke.berlin/prosemirror/prosemirror-view/src/branch/main/src/index.ts) — prop lookup and view lifecycle.
- [`prosemirror-keymap` source](https://code.haverbeke.berlin/prosemirror/prosemirror-keymap/src/branch/main/src/keymap.ts) and [`prosemirror-commands` source](https://code.haverbeke.berlin/prosemirror/prosemirror-commands/src/branch/main/src/commands.ts) — ordered command handling.
- [Upload example](https://prosemirror.net/examples/upload/) — safe asynchronous completion through current state.

### Geographic data and rendering

- [MapLibre sources](https://maplibre.org/maplibre-style-spec/sources/) and [layers](https://maplibre.org/maplibre-style-spec/layers/) — separation of data, filters, and presentation.
- [MapLibre expressions](https://maplibre.org/maplibre-style-spec/expressions/) — literals, `get`, `has`, `case`, `coalesce`, `image`, conversion, interpolation, and `global-state`.
- [MapLibre root state](https://maplibre.org/maplibre-style-spec/root/#state) and [`Map.setGlobalStateProperty`](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setglobalstateproperty) — native map-wide values used by style expressions.
- [MapLibre runtime images](https://maplibre.org/maplibre-gl-js/docs/examples/add-an-icon-to-the-map/), [fallback images](https://maplibre.org/maplibre-gl-js/docs/examples/use-a-fallback-image/), and [`styleimagemissing`](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-remote-svg-symbol/) — image registration, availability, and fallback behavior.
- [RFC 5870](https://www.rfc-editor.org/rfc/rfc5870.html) — `geo:` URI syntax and latitude/longitude order.
- [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) — GeoJSON geometry, WGS84, and longitude/latitude order.
