# Tested Roam Map examples

These examples use the current Roam Map outline grammar and correspond to
fixture shapes exercised in Roam Desktop. Placeholder page titles such as
`[[People]]/Example Person` should be replaced with pages from your graph.
They use ordinary Roam blocks: indentation below represents child blocks.

For the concepts behind each form, supported values, extension points, and
current limitations, see the
[customization reference](https://github.com/MaskyS/roam-map/blob/main/customization.md).

## Before copying an example

- Give each location page a valid `Coordinates:: geo:latitude,longitude`,
  either directly or through Roam Places.
- Put each page reference or block-backed point in its own block beneath
  `{{map}}`.
- Use a real Roam code block as the only child of each `MapLibre layer` or
  inline `Marker click` block.
- Enable Roam's custom-components setting before using a `Marker click` code
  block.
- Keep network attribution visible.

## Basic live map

```text
{{map}}
  [[Port Louis]]
  [[Curepipe]]
  [[Mahébourg]]
```

The map follows source order, deduplicates repeated page references, and fits
the first non-empty result once. Later graph edits update the data without
discarding the user's viewport. Clicking a marker opens the stock Blueprint
card; **Open in sidebar** uses the source entity's stable UID.

## Native query and Datalog source maps

The first fixture is a saved native Roam query. It returns the `roam/meta::`
blocks beneath located Effort pages; Roam Map promotes each result block to its
containing Effort page, whose location metadata supplies the point.

Located Efforts:

```text
{{map}}
  {{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

The adjacent map independently executes that saved query by block UID and maps
the containing Effort pages. It does not read the rendered result DOM.

![A native Roam query supplying located Effort pages to a map and synchronized results panel](https://raw.githubusercontent.com/MaskyS/roam-map/main/assets/roam-map-query-input.webp)

Located People:

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

The more interesting fixture asks which `[[San Francisco]]/…` location pages
were mentioned in the same daily-note block as a Person page:

````text
{{map}}
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
````

The shared `?mention` variable means the person and place must occur in the
same block; `:log/id` restricts that block to a daily-note page. Joining only on
the same daily-note page can find extra candidates without establishing the
same relationship. The narrower query chooses precision instead of silently
asserting it.

The same shape can be reused with a second Person page:

````text
{{map}}
  ```clojure
  [:find [?place-uid ...]
   :where
   [?person :node/title "[[People]]/Example Person B"]
   [?place :node/title ?place-title]
   [(clojure.string/starts-with? ?place-title "[[San Francisco]]/")]
   [?mention :block/refs ?person]
   [?mention :block/refs ?place]
   [?mention :block/page ?daily-page]
   [?daily-page :log/id ?date]
   [?place :block/uid ?place-uid]]
  ```
````

Returned place pages still need location metadata. Roam Map does not rename,
classify, geocode, or otherwise rewrite them as a rendering side effect.

Use `[:find [?uid ...] ...]` for a flat UID collection or `[:find ?uid ...]`
for a one-column UID relation. A query that returns titles, entity IDs, maps,
or several columns is deliberately rejected. The same source may instead be
saved elsewhere and included as one direct-child block reference.

The native fixture keeps returned pages and turns returned blocks into their
containing pages. It does not infer which referenced page inside a result block
might be the intended place. Datalog is therefore the clearer choice when the
desired map entity differs from the result block's containing page.

## Block coordinate sources

This fixture is also present on the live `[[Roam Map Test]]` page. It shows the
two supported block-backed forms together:

```text
{{map}}
  geo:-20.1609,57.5012;u=14.4
  Curepipe block point
    Coordinates:: geo:-20.3163,57.5251
    Address:: Curepipe, Mauritius
```

The first marker belongs to the bare `geo:` block. The second belongs to the
named parent block, whose child supplies its coordinates. Opening either
marker in the sidebar opens that source block. The `u=14.4` parameter records
14.4 metres of uncertainty; it does not move the point.

## Saved map size

Hover over a map to reveal the small grip just outside its bottom-right corner.
Drag it and Roam Map creates or updates one ordinary `map/size` child. The same
result can be authored directly:

```text
{{map}}
  map/size:: 900 × 520
  [[Port Louis]]
  [[Curepipe]]
```

The first number is a responsive maximum width; the second is height. Use
`auto` for either dimension, such as `map/size:: auto × 520`. Use **Reset map
size** in the toolbar to remove the child and restore both defaults.

## Circular image markers

This is the tested People-map pattern. Each person page has a location and a
`Profile Picture` containing complete HTTP(S) image Markdown:

```text
Profile Picture:: ![](https://example.com/person.jpg)
Coordinates:: geo:34.0522,-118.2437
```

The map adds two ordinary MapLibre layers over Roam Map's compiled source. The
base circle keeps every point visible, including pages with missing or broken
images. The symbol layer presents pages with a registered picture.

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

The compiler projects the readable attribute title `Profile Picture` as the
feature key. Valid image Markdown becomes an opaque runtime image ID. Roam Map
loads Roam-hosted files through Roam's supported file API, center-crops them,
and registers both square and alpha-clipped circular variants. Appending
`#circle` selects the circular registration without exposing the underlying URL
to the MapLibre expression.

If your pages use `Image` instead, change both occurrences of `Profile Picture`
in the symbol layer to `Image`.

## Custom effort popup

This tested example replaces the stock marker card with graph-authored JSX. It
receives only the click snapshot, then uses the clicked `entityUid` and the Roam
Alpha API to read `Image::`, `Description::`, and `URL::` itself. The image is
not passed through a special plugin argument.

The component reuses Roam Map's public `MarkerPopover`, `MarkerCard`, details,
and action components. A graph author could replace any of those pieces or
return `null` and run only an effect.

````text
{{map}}
  [[[[Efforts]]/Coral Vita]]
  [[[[Efforts]]/PlanetCare]]
  [[[[Efforts]]/Open Source Ecology]]
  Marker click
    ```jsx
    function effortMarkerClick({ args }) {
      const context = JSON.parse(decodeURIComponent(args[1]));
      const {
        MarkerCard,
        MarkerCardActions,
        MarkerCardDetails,
        MarkerPopover,
      } = window.RoamMap.components;

      const entityAttributesPull = `[
        {:harc/_e [
          {:harc/a [:node/title]}
          {:harc/v [:node/title :block/string :harc/v-string :harc.text/string]}
        ]}
        {:block/children [
          :block/string
          {:harc/_e [
            {:harc/a [:node/title]}
            {:harc/v [:node/title :block/string :harc/v-string :harc.text/string]}
          ]}
          {:block/children [:block/string]}
        ]}
      ]`;

      const toArray = (value) =>
        value == null ? [] : Array.isArray(value) ? value : [value];

      function displayValue(value) {
        if (["string", "number", "boolean"].includes(typeof value)) return value;
        return value?.[":node/title"] ??
          value?.[":block/string"] ??
          value?.[":harc/v-string"] ??
          value?.[":harc.text/string"] ??
          null;
      }

      function addAttribute(attributes, title, rawValue) {
        const name = typeof title === "string" ? title.trim() : "";
        const display = displayValue(rawValue);
        const value = typeof display === "string" ? display.trim() : display;
        if (!name || value == null || value === "") return;

        const values = attributes[name] ?? (attributes[name] = []);
        if (!values.includes(value)) values.push(value);
      }

      function collectCurrentAttributes(attributes, entity) {
        for (const relation of toArray(entity?.[":harc/_e"])) {
          const title = toArray(relation[":harc/a"])[0]?.[":node/title"];
          for (const value of toArray(relation[":harc/v"])) {
            addAttribute(attributes, title, value);
          }
        }
      }

      function collectAttributeBlock(attributes, block) {
        const source = String(block?.[":block/string"] ?? "");
        const separator = source.indexOf("::");
        if (separator < 1) return;
        addAttribute(attributes, source.slice(0, separator), source.slice(separator + 2));
      }

      function readEntityAttributes(entityUid) {
        const entity = window.roamAlphaAPI.data.pull(
          entityAttributesPull,
          [":block/uid", entityUid]
        );
        const attributes = {};

        // Read current HARC attributes and compatibility `Attribute:: value` blocks.
        collectCurrentAttributes(attributes, entity);
        for (const child of toArray(entity?.[":block/children"])) {
          collectCurrentAttributes(attributes, child);
          const attributeBlocks = child[":block/string"] === "roam/meta::"
            ? toArray(child[":block/children"])
            : [child];
          attributeBlocks.forEach((block) => collectAttributeBlock(attributes, block));
        }
        return attributes;
      }

      const firstValue = (attributes, title) => attributes[title]?.[0] ?? null;

      function imageUrlFromMarkdown(value) {
        if (typeof value !== "string") return null;
        return value.trim().match(/^!\[[^\]]*\]\((https?:\/\/.+)\)$/)?.[1] ?? null;
      }

      return (
        <MarkerPopover context={context}>
          {({ close }) => (
            <MarkerCard context={context} onClose={close}>
              {(card) => {
                const attributes = readEntityAttributes(card.entityUid);
                const imageUrl = imageUrlFromMarkdown(firstValue(attributes, "Image"));
                const description = firstValue(attributes, "Description");
                const website = firstValue(attributes, "URL");
                const label = card.feature.properties["roam/label"];

                return (
                  <>
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt={label}
                        style={{ width: "100%", height: 110, objectFit: "contain" }}
                      />
                    )}
                    <MarkerCardDetails {...card} />
                    {description && <p>{description}</p>}
                    {typeof website === "string" && (
                      <a href={website} target="_blank" rel="noreferrer">
                        Visit website ↗
                      </a>
                    )}
                    <MarkerCardActions {...card} />
                  </>
                );
              }}
            </MarkerCard>
          )}
        </MarkerPopover>
      );
    }
    ```
````

The context contains `version`, `mapUid`, `clickId`, `entityUid`,
`identityKind`, `entityUids`, `coincidentEntityUids`, `feature`, `features`,
`point`, `lngLat`, `clientPoint`, and keyboard modifiers. `entityUid`
identifies the nearest marker; `coincidentEntityUids` preserves sources
occupying the same visible point.

To reuse the same component on several maps, put the JSX in one code block and
reference that exact block:

```text
Marker click
  ((reusable-code-block-uid))
```

Roam Map watches referenced code, invokes it through Roam's documented
`renderString` API, and calls `unmountNode` when the component is replaced or
the map is removed.

## External MapLibre style URL

This example uses a complete style URL that is neither built into Roam Map nor
derived from its MapTiler shortcut. The URL is MapLibre's public demonstration
style and requires no key.

Open **Settings → Roam Depot → Roam Map → Basemap catalog**, then add:

| Field | Value |
| --- | --- |
| Name | `MapLibre Demo` |
| Format | `Complete MapLibre style URL` |
| Style URL | `https://demotiles.maplibre.org/style.json` |

After saving the catalog entry, use its readable name in Roam:

```text
{{map}}
  map/basemap:: MapLibre Demo
  [[Port Louis]]
  [[Curepipe]]
```

Roam Map passes the URL to `Map#setStyle`, then restores its compiled feature
source, marker layer, authored layers, and runtime images after the external
style loads. The URL is saved once in graph-synced extension settings; map
blocks contain only its name. The demo endpoint currently returns a valid
version-8 style with browser CORS enabled, but it is a demonstration service,
not a promise of production hosting.

## Saved satellite context

Use a readable map attribute to save a basemap choice without changing any
place page:

```text
{{map}}
  map/basemap:: EOX Satellite Context
  [[Port Louis]]
  [[Curepipe]]
```

EOX Satellite Context is the attributed 2016 global Sentinel-2 mosaic at 10 m
resolution. It is useful for regional context through zoom 14; it is not
current, building-level satellite photography. The toolbar may preview another
catalog entry without overwriting this saved value.

For current higher-resolution imagery, configure a MapTiler browser key in the
Roam Map settings and use either:

```text
map/basemap:: MapTiler Satellite
```

or:

```text
map/basemap:: MapTiler Hybrid
```

The key is graph-synced and appears in browser requests, so treat it as a
restricted public browser key rather than a secret.

## If an example does not render

Check the map's source, mapped, and unmapped counts and expand its diagnostics.
Common causes are an invalid `Coordinates` geo URI, multiple distinct page links
in one source block, a Datalog result that is not a UID collection, invalid
layer JSON, a duplicate or reserved layer ID, a foreign MapLibre source ID, or
disabled custom components.

Roam Map deliberately reports these locally and does not repair or rewrite the
source outline.
