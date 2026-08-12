# Basemap providers and settings UX — options evaluation

Status: proposal for discussion. Nothing here is implemented.

This document evaluates where basemap configuration and choice should live, and
how Roam Map should model basemap providers. Every provider claim below comes
from the provider's own documentation (URLs inline); the MapLibre claims come
from maplibre.org docs; the code claims from this repository.

## The problem

Today one Roam Depot settings panel holds everything basemap-related, and it
shows. Concretely (file references as of this writing):

- The provider seam exists (`PROVIDER_ADAPTERS`, `src/settings/basemap-registry.js:89`)
  but only MapTiler is registered, frozen to exactly two styles
  (`MAPTILER_VARIANTS`, `:34`). Every other MapTiler style requires pasting a
  keyed URL into a *custom* entry, which copies the key outside the provider
  record and defeats rotation and redaction.
- The settings panel never lists the built-in catalog, offers no preview, no
  reachability check, and a nine-field raster form with no derived defaults.
- The map toolbar can only *preview* a basemap. The two inputs a save action
  needs — the entry's `settingValue` (`basemap-registry.js:268`) and the option
  block uid (`options.js:202`) — are computed and consumed nowhere, while
  `map/size` already demonstrates the write-back pattern
  (`src/map/size-persistence.js`).
- A hand-typed free-text name is the join key between settings and
  `map/basemap::` blocks.

## Reference model: what MapLibre itself does

MapLibre GL JS has **no concept of provider or API key**. The style — a URL or
a JSON object handed to `map.setStyle()` — is the entire basemap, and it
carries all provider specifics: sources, `glyphs`, `sprite`, per-source
`attribution` (https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/).
Keys are just substrings of URLs; header-based auth goes through
`transformRequest`; non-HTTP tile formats (PMTiles) go through the global
`addProtocol`, which is still a plugin, not core
(https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles-source-and-protocol/).
Basemap *switcher UIs* are explicitly community-plugin territory
(https://maplibre.org/maplibre-gl-js/docs/plugins/), and the project's provider
list lives in https://github.com/maplibre/awesome-maplibre.

Design consequence: a provider in Roam Map should be nothing more than
**a style-URL template + a credential slot + a curated style list + policy
metadata**. Anything heavier is an abstraction MapLibre will fight.

Two version notes for later: MapLibre v5+ sanitizes attribution HTML but still
renders it as HTML (our escaping stays correct on the bundled v4-era build),
and MapLibre v6 is ESM-only, which affects the bundling setup on any future
upgrade.

## Provider facts that constrain the design

The decisive Roam-specific constraint: **extension settings sync to every
member of a shared graph.** A key stored there is readable by all
collaborators. So the question "can this key be origin/referrer-restricted?"
is not a footnote — it decides how a provider may be presented.

| Provider | Key | Restrictable? | Free tier fits Roam? | Styles (MapLibre-ready) |
|---|---|---|---|---|
| OpenFreeMap | none | n/a | Yes — "no limits on the number of map views or requests", commercial allowed, no SLA (openfreemap.org) | 5 vector |
| MapTiler | `?key=` | **Yes** — origins whitelist w/ wildcards, admin API (docs.maptiler.com/cloud/api/authentication-key/) | Non-commercial + logo required on free | ~8 families × variants; v4 generation, v2 deprecated |
| Esri ArcGIS | `?token=` (mandatory; 499 without) | Referrer restrictions exist | 2M tiles or 1k sessions/mo free, then metered (developers.arcgis.com/rest/basemap-styles/) | ~24 styles incl. **imagery/satellite** |
| Protomaps hosted | `?key=` | **Yes** — per-key CORS origin allowlist (protomaps.com/api) | Non-commercial only; 1M req/mo soft limit | 5 flavors |
| Stadia | `?api_key=` or domain auth | No key restriction documented; domain auth authenticates *all* of roamresearch.com — wrong isolation for a multi-tenant host | Non-commercial on free | 8 families incl. Stamen |
| Thunderforest | `?apikey=` | No — headers used for account association, not enforcement (thunderforest.com/docs/apikeys/) | 150k tiles/mo | 10 raster, 3 vector |
| Jawg | `?access-token=` (hyphen) | Not documented | **No — free tier excludes login-gated sites** (jawg.io/en/pricing/) | 6 defaults |
| CARTO | endpoints open, no key | n/a | **No — ToS: "available exclusively with an Enterprise license"** (docs.carto.com/faqs/carto-basemaps) | 6 vector verified |
| OSM raster | none | n/a | Tolerated, best-effort, "may block access, without notice" (operations.osmfoundation.org/policies/tiles/) | 1 raster |
| OpenTopoMap | none | n/a | Server downsized Jan 2026, maintainers retiring it — at risk | 1 raster |
| PMTiles self-host | user's bucket | user's CORS | Yes — user-owned infra | 5 Protomaps flavors; needs bundled `pmtiles` adapter + `addProtocol` |

Cross-cutting fact: **no provider offers a machine-readable style-enumeration
API.** Style lists must be curated constants in the extension and will churn
(MapTiler shipped a v4 generation in late 2025 and deprecated v2 ids). The
style list is therefore *data we maintain per release*, not something the UI
can discover.

## Three concerns the current design conflates

1. **Credentials / provider enablement** — inherently graph-global,
   admin-gated, security-sensitive. Needs sync.
2. **The catalog** — the set of named basemaps that exist for this graph,
   i.e. the names `map/basemap::` may reference. Needs sync and uniqueness.
3. **The per-map choice** — which catalog entry one map uses. Belongs to the
   map block, already lives in the graph (`map/basemap::`).

Evaluating "where should basemap settings live" per concern rather than as one
lump is what makes the options tractable.

## Placement options

### Option A — status quo, improved in place

Keep everything in the depot settings panel; per-map choice stays hand-typed.

- For: one location; sync and `canSet` gating already work; smallest change.
- Against: the *act of choosing* stays disconnected from the map where the
  result is visible; the panel must grow provider cards *and* catalog *and*
  custom forms, compounding the crowding that prompted this document; the
  name-copying workflow ("read name in settings, type it under the map")
  remains the primary UX.

### Option B — toolbar-first: choose and save at the map

The toolbar select becomes the primary picker: grouped by provider, preview on
select (exists today), plus a **Save** affordance that writes `map/basemap::`
via the same pattern as `map/size` persistence. Settings retain only what must
be global.

- For: choice happens where the consequence is visible; catalog discovery
  becomes "open the menu"; kills the hand-typing/name-copying loop; the code
  seams are already in place (unused `settingValue`, unused
  `optionSourceUids.basemap`, `size-persistence.js` as the template), so the
  incremental cost is genuinely small; matches where the MapLibre ecosystem
  puts style switchers (on-map controls).
- Against: writing to the graph from a toolbar needs a clear preview-vs-commit
  distinction (already conceptually present); a menu spanning several
  providers needs grouping and key-state awareness ("needs key" states).

### Option C — graph-authored catalog (basemaps defined as blocks)

Define basemaps in the graph itself (e.g. a `roam/map/basemaps` page, or a
per-map `map/style::` child holding a style URL).

- For: catalog becomes portable, versionable, shareable graph content; fits
  the extension's existing "graph-authored code/presentation" niche;
  ARCHITECTURE.md already defers a `map/style` composition boundary.
- Against: **keys must never live in blocks** — blocks are searchable,
  exportable, and visible to anyone with graph access, strictly worse than
  settings; validation/error surfaces multiply; two sources of truth if the
  settings catalog remains; worse discoverability for non-technical users.
- Verdict: wrong as the primary mechanism, right as a *later* power feature
  for keyless one-off styles (`map/style:: <url>` on a single map — no
  catalog entry needed).

### Option D — recommended hybrid: split along the three concerns

- **Providers & keys → depot settings.** The panel's main content becomes one
  card per supported provider: credential field, "get a key" link, provider-
  specific **restriction instructions**, per-style enable toggles, and the
  provider's policy notice. Sync, `canSet` gating, and redaction already live
  here and are exactly what credentials need. (This keeps the depot location —
  acceptable per discussion — but changes what it holds.)
- **Choice → map toolbar with save (Option B).** Preview stays cheap; Save
  writes the attribute; the settings panel stops being part of the everyday
  choosing flow entirely.
- **Custom entries → stay in settings for now**; add graph-authored
  `map/style::` later for keyless per-map one-offs (Option C's good half).
- **Add a graph-wide default basemap** setting. Today the default is the
  frozen constant `"streets"` (`options.js:21`); a registry-provided default
  is cheap and frequently wanted.

## Provider model

Generalize the existing `PROVIDER_ADAPTERS` seam; a declarative record per
provider, one generic settings card rendering all of them (the bespoke
`MapTilerShortcut` component and its literal `"maptiler"` strings disappear):

```js
{
  id: "maptiler",
  label: "MapTiler",
  credential: {
    param: "key",                    // rides in the style URL, MapLibre-native
    label: "API key",
    keyUrl: "https://cloud.maptiler.com/account/keys/",
    restriction: {
      kind: "origins-allowlist",     // drives the security copy shown
      url: "https://docs.maptiler.com/guides/.../how-to-protect-your-map-key/",
    },
    notice: "Free plan is non-commercial and requires the MapTiler logo.",
  },
  styles: [                          // curated; no provider enumerates styles
    { id: "streets-v4", label: "Streets", kind: "vector",
      url: (key) => `https://api.maptiler.com/maps/streets-v4/style.json?key=${key}` },
    // …
  ],
  defaultEnabled: ["streets-v4", "satellite-v4", "hybrid-v4"],
}
```

No `transformRequest` machinery is needed for any provider on the shortlist —
every one passes the key in the style URL, which is the MapLibre-native shape.
`addProtocol` + a bundled `pmtiles` adapter is only needed if/when the PMTiles
custom kind ships (bundling keeps it depot-compliant).

### Recommended tiers

- **Tier 1 — built-in, keyless:** OpenFreeMap (unchanged; the only provider
  whose docs permit unlimited commercial multi-user use with no key) and the
  EOX satellite entry until a better satellite story exists.
- **Tier 2 — first-class keyed providers:** **MapTiler** (only provider with a
  true per-key origins whitelist; expand from the frozen 2 variants to the
  curated v4 list with per-style toggles), **Esri ArcGIS** (referrer-
  restrictable, 2M free tiles/mo, and the strongest current-imagery answer —
  the 2016 EOX mosaic stops being the only satellite option), **Protomaps
  hosted** (per-key CORS allowlist; present as the non-commercial/personal
  option its ToS describes; note its glyphs/sprites load from
  protomaps.github.io, a second host).
- **Tier 3 — supported with an explicit warning:** **Stadia** and
  **Thunderforest**. Their keys cannot be origin-restricted, so the card must
  say plainly: *"Anyone in this graph can read this key, and the provider
  offers no way to restrict where it is used."* Ship them because the styles
  (Stamen; outdoor/cycling) are genuinely wanted; make the risk unmissable.
- **Not shipped, documented why:** **Jawg** (free tier excludes login-gated
  sites — Roam is one; no restriction mechanism) and **CARTO** (endpoints are
  open but the ToS grants use only to Enterprise licensees and grantees).
  **OSM raster / OpenTopoMap / CyclOSM**: skip — best-effort community infra
  (OpenTopoMap is actively winding down), and OpenFreeMap already covers the
  keyless niche within policy.
- **Later:** PMTiles custom kind for self-hosters (bundled adapter +
  `addProtocol`), and `map/style::` graph-authored one-offs.

### Honest key-security framing

Origin restriction does not make a synced key private: any graph member can
read it, and an origin-restricted key still works from inside Roam. The card
copy should state both halves: *restriction protects the key if it leaks
beyond Roam; graph membership decides who can see and spend it inside Roam.*
This framing already matches the code's stance (keys as public browser keys,
redaction as hygiene) — the UI just needs to say it per provider.

## Migration hazard (must precede any of this)

`normalizeMapTilerConfiguration` returns `{apiKey}` only
(`basemap-registry.js:60-71`): the passthrough protection preserves unknown
*providers* and unknown *root keys*, but a known provider's unknown fields are
**silently stripped** on the next write by an older build. Before any
`styles:` field ships in provider records, either bump
`BASEMAP_SETTINGS_VERSION` to 3 (older builds then go read-only, which the
panel already handles) or make provider normalization field-preserving.
Do this first; it is the one change that can destroy user data if ordered
wrong.

## Panel fixes worth doing regardless of placement decisions

- List the built-in catalog in the panel (admins currently discover name
  collisions only via the error).
- Copyable `map/basemap:: Name` string on every saved entry, not just inside
  the editor form.
- Masked-tail key display (`…a1b2`) instead of loading the stored key verbatim
  into a password input.
- A "Check" button on custom entries: fetch the style URL / probe one tile and
  report status, instead of failing later inside a mounted map. (The
  deliberate no-preview stance in customization.md:328 is about thumbnails;
  a reachability check is a different, cheaper promise.)
- Derive raster-form defaults from the pasted URL where possible.
- Re-read settings when the panel opens (today: read once per session at
  registry construction, so another admin's edits are invisible until reload).

## Suggested sequencing

1. Migration safety: version bump or field-preserving normalization.
2. Generic provider card + adapter records; MapTiler grows its curated v4
   style list. (Settings UX debt largely resolved here.)
3. Toolbar save (`persistMapBasemap` mirroring size-persistence) + grouped
   basemap menu; graph-wide default setting.
4. Esri + Protomaps adapters; satellite story moves to Esri.
5. Tier-3 providers with warnings; panel fixes from the list above.
6. Later: PMTiles kind, `map/style::` one-offs.

Steps 1–3 are the smallest set that answers the original complaint: settings
stop being the UX bottleneck, and providers stop being a MapTiler special
case.
