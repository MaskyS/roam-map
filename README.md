# Roam Map

Roam Map turns location pages and blocks into live maps inside Roam. Choose
places directly, collect them with a native query, or return exact page and
block UIDs with Datalog. The map stays connected to its Roam sources and opens
them in the right sidebar when you need the underlying notes.

**Install [Roam Places](https://github.com/MaskyS/roam-places) alongside Roam
Map.** Roam Map renders location data; Roam Places is the recommended way to
create it. Its `/Place` command searches your graph and online place services,
then saves the coordinates Roam Map reads — no attribute editing by hand.
Everything below works without it, but every step is easier with it.

![A Roam Map showing five places, its toolbar, a marker card, and the source outline](https://raw.githubusercontent.com/MaskyS/roam-map/main/assets/roam-map-basic-example.webp)

## Create your first map

1. Give each place page a `Coordinates` attribute. The quickest way is the
   Roam Places `/Place` command, which saves this while you write. To add one
   by hand instead:

   ```text
   roam/meta::
     Coordinates:: geo:-20.1609,57.5012
   ```

2. Type `/map` and choose **Map (Roam Map)**, or type `{{map}}` in a block.

3. Add each place reference in its own descendant block:

   ```text
   {{map}}
     [[Port Louis]]
     [[Curepipe]]
   ```

Parent blocks can group places. Roam Map follows outline order, removes
duplicates, and updates when known sources or their location details change.

## Choose what appears

A map can read:

- location page references;
- a bare `geo:latitude,longitude` block;
- a named block with a `Coordinates` child;
- a native Roam query placed directly beneath the map; or
- a fenced Datalog query placed directly beneath the map that returns page or
  block UIDs.

For example, a native query can keep a map tied to changing graph content:

```text
{{map}}
  {{[[query]]: {and: [[Efforts]] {search: roam/meta::}}}}
```

Native-query block results map through their containing page. Use Datalog when
you need to select exact location pages or block-backed points. Press
**Refresh** when an unrelated page may have started or stopped matching a
dynamic query.

See the [tested query and Datalog examples](https://github.com/MaskyS/roam-map/blob/main/examples.md#native-query-and-datalog-source-maps)
for copyable patterns, including relationship-aware maps.

## Use the map

- Click the place count to open a text-first results list. Selecting a row
  highlights and focuses its point; **Open in sidebar** returns to its source.
- Use **Fit** to frame the current places and **Refresh** to rerun all sources.
- Use the basemap menu to preview another style. Add a child such as
  `map/basemap:: OpenFreeMap Dark` when the choice should be saved with the map.
- Hover near the bottom-right corner and drag the resize grip. Roam Map saves
  the result in one readable `map/size` child; **Reset map size** restores the
  responsive default.
- Click a marker for its label, address, overlapping places, and source action.

Map movement is intentionally temporary. Roam Map does not save pan, zoom,
bearing, or pitch.

## Location data

`Coordinates` uses a plain two-dimensional WGS84 `geo:` URI with latitude
first and longitude second. An optional `u` parameter records uncertainty in
metres. Roam Map can also render a GeoJSON Point from `Geometry`; lines,
polygons, and other non-point geometry are reported rather than drawn as
markers.

`Address` and `Geocoder ID` add useful place details. Other scalar attributes
can drive advanced MapLibre styling. Roam Map reads both current Roam
attributes and compatibility `Attribute:: value` blocks, including attributes
beneath an exact `roam/meta::` child. Rendering never rewrites a source block
or location page.

## Basemaps

OpenFreeMap Liberty is the default. Keyless alternatives include OpenFreeMap
Positron, Bright, Dark, and Fiord, plus the attributed 2016 EOX Satellite
Context mosaic.

Graph administrators can open **Settings → Roam Depot → Roam Map → Basemap
catalog** to add a complete MapLibre style URL, an attributed raster tile
template, or the optional MapTiler shortcut. Catalog settings sync with the
graph: collaborators may be able to read configured URLs and browser keys, and
providers receive those values in browser requests. Use restricted public
browser keys, not secrets.

Opening a map loads styles, sprites, fonts, and tiles from its selected
providers. Roam Map keeps required provider and OpenStreetMap attribution in
the map. Reading pages, native queries, and Datalog results from the current
graph does not contact an external search service.

## Advanced maps

Roam Map also supports data-driven MapLibre layers, image markers, reusable
marker cards, and custom results lists. These are graph-authored code and
presentation resources rather than extra location fields.

- [Open the tested examples](https://github.com/MaskyS/roam-map/blob/main/examples.md)
- [Read the complete customization reference](https://github.com/MaskyS/roam-map/blob/main/customization.md)

Enable Roam's custom-components setting before using graph-authored JavaScript,
JSX, or Clojure components, and treat that code as trusted graph content.

## Current limits

- Maps render points; lines, polygons, clustering, and arbitrary authored
  GeoJSON sources are separate capabilities.
- Dynamic membership comes from native queries or fenced Datalog, not search
  components, saved `:q` components, or `{{map: ...}}` arguments.
- Roam Map does not geocode, classify, or rename sources. Use Roam Places or
  edit the location page directly.

## Help and development

- [Tested examples](https://github.com/MaskyS/roam-map/blob/main/examples.md)
- [Customization reference](https://github.com/MaskyS/roam-map/blob/main/customization.md)
- [Issues and planned work](https://github.com/MaskyS/roam-map/issues)

For local development:

```bash
npm install
npm run dev
npm run check
```

Load the repository through **Settings → Roam Depot → Load local folder**.
