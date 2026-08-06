# Roam Map contributor instructions

Roam Map is a deliberately narrow Roam Depot extension for persistent maps.

## Product boundary

- Roam owns editing and durable data.
- Roam Places owns place capture; Roam Map owns source aggregation and map
  rendering.
- Normalize all sources to page UIDs before reading geographic data.
- Never rewrite user source blocks or location pages as a rendering side effect.
- Do not use query-result DOM as data. Use the Roam Alpha API.
- Keep point, geometry, provenance, and layer data independent of MapLibre
  objects.

## Required Roam documentation gate

Agents must not design, review, debug, or implement a nontrivial Roam Map
change from memory alone.

If you have not already read the current applicable Roam documentation during
the active task, open and read it on https://roamdocs.fyi before forming a plan
or editing code. Merely knowing the API, citing a page, or planning to read it
later does not satisfy this gate. Documentation changes, and several APIs now
have newer names or behavior than older examples found elsewhere.

Start with the sections below when they are relevant, but do not treat this as
an exhaustive list. Follow links and read any additional current page needed by
the behavior under consideration.

- Roam Depot and extension mechanics:
  - https://roamdocs.fyi/developer-documentation/roam-depot-extensions
  - https://roamdocs.fyi/developer-documentation/roam-depot-extension-api
  - https://roamdocs.fyi/help/roam-depot
- Roam Alpha API, data mechanics, UI mechanics, focus, components, pull
  watches, search, query execution, sidebars, and custom main-window views:
  - https://roamdocs.fyi/developer-documentation/roam-alpha-api
  - https://roamdocs.fyi/developer-documentation/data-model
- Blocks, pages, references, outlines, formatting, navigation, and interaction:
  - https://roamdocs.fyi/help/blocks
  - https://roamdocs.fyi/help/pages
  - https://roamdocs.fyi/help/block-references
  - https://roamdocs.fyi/help/page-references
  - https://roamdocs.fyi/help/navigation
- Slash commands, command palette commands, context menus, and hotkeys:
  - https://roamdocs.fyi/help/commands
  - https://roamdocs.fyi/help/command-palette
  - https://roamdocs.fyi/help/block-context-menu
- Both the current and compatibility attribute representations, including the
  `roam/meta::` structural proxy:
  - https://roamdocs.fyi/developer-documentation/attributes-data-model-new
  - https://roamdocs.fyi/developer-documentation/attributes-data-model
- Native Roam queries, the query builder, Datalog `:q`, Roam-specific symbols,
  result shapes, and refresh/reactivity behavior:
  - https://roamdocs.fyi/help/query
  - https://roamdocs.fyi/help/roam-query-builder
  - https://roamdocs.fyi/help/examples-of-q-query-blocks
  - https://roamdocs.fyi/help/roam-specific-q-additions
  - https://roamdocs.fyi/developer-documentation/datalog-block-query
- Search components and the programmatic search API:
  - https://roamdocs.fyi/developer-documentation/roam-alpha-api
- Rendering and component surfaces, including the distinction between
  `roam/render`, existing Roam components, and extension-owned React roots:
  - https://roamdocs.fyi/developer-documentation/roam-render
  - https://roamdocs.fyi/help/roam-render
- Roam's current documentation index, release notes, and change log whenever a
  relevant capability may have changed:
  - https://roamdocs.fyi/
  - https://roamdocs.fyi/developer-documentation/release-notes
  - https://roamdocs.fyi/help/change-log

Prefer supported APIs over DOM assumptions. If the documentation does not
provide the required surface, state that clearly and verify the smallest
possible DOM seam in live Roam before adopting it. If current documentation
conflicts with observed behavior, record the conflict and test the installed
Roam client rather than silently choosing one.

## Roam-provided frontend libraries

Roam currently ships React 18.2.0 and the matching React DOM globals, plus
Blueprint Core, Select, and DateTime and several other synchronous and lazy
libraries. Treat these as Roam-provided libraries, not as packages to bundle
again by default.

Before adding or upgrading a frontend dependency, read the current
[Available Libraries](https://roamdocs.fyi/developer-documentation/available-libraries)
page. It is the authoritative list of package versions, window globals, and
lazy-loading expectations. In particular, use `window.React`,
`window.ReactDOM`, `window.ReactDOMClient`, and the applicable
`window.Blueprint` exports when the documented Roam extension surface makes
them available. Keep bundler externals aligned with that current list and
verify the resulting artifact does not contain a second React runtime.

## Development approach

1. Pass the documentation gate above.
2. Make the smallest change that improves the live edit/render/inspect loop.
3. Prefer documented Alpha and Extension APIs. Isolate unavoidable DOM
   integration behind one lifecycle boundary.
4. Test mount/unmount cleanup, duplicate renders, source invalidation, and
   conservative graph reads.
5. Verify important behavior in live Roam, not only in DOM mocks.

## Safety

- Clean up observers, pull watches, React roots, maps, markers, requests, and
  listeners on unmount and extension unload.
- Treat the same block rendered in different windows as distinct UI instances.
- Keep network attribution visible.
- Do not persist pan/zoom continuously. Save presentation state only through an
  explicit user action.
