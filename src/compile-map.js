import { FEATURE_PROPERTIES } from "./map-contract.js";

function uniqueDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((item) => {
    const key = item.key ?? `${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderDiagnostic(item, record) {
  return {
    key: `render.unsupported-geometry:${item.pageUid}`,
    code: "render.unsupported-geometry",
    severity: "warning",
    pageUid: item.pageUid,
    sourceBlockUid: item.provenance[0]?.sourceBlockUid ?? null,
    message: `${record.label} has valid ${record.feature.geometry.type} geometry, but this milestone renders points only.`,
  };
}

export function createMapCompiler({ sourceCompiler, placeResolver }) {
  async function compile(mapUid) {
    const source = await sourceCompiler.compile(mapUid);
    const records = await Promise.all(
      source.items.map(async (item) => {
        try {
          return { item, record: await placeResolver.resolvePage(item.pageUid) };
        } catch (error) {
          return {
            item,
            record: null,
            error: {
              key: `place.resolve-failed:${item.pageUid}`,
              code: "place.resolve-failed",
              severity: "error",
              pageUid: item.pageUid,
              sourceBlockUid: item.provenance[0]?.sourceBlockUid ?? null,
              message: `The place page could not be read: ${error?.message ?? String(error)}`,
            },
          };
        }
      }),
    );

    const features = [];
    const assets = new Map();
    const attributeWatchUids = new Set();
    const diagnostics = [...source.diagnostics];
    const resolved = [];
    for (const entry of records) {
      if (entry.error) {
        diagnostics.push(entry.error);
        continue;
      }
      const { item, record } = entry;
      diagnostics.push(...record.diagnostics);
      for (const uid of record.attributeUids ?? []) attributeWatchUids.add(uid);
      for (const asset of record.assets ?? []) {
        if (!assets.has(asset.id)) assets.set(asset.id, asset);
      }
      resolved.push({ item, record });
      if (!record.feature) continue;
      if (record.feature.geometry.type !== "Point") {
        diagnostics.push(renderDiagnostic(item, record));
        continue;
      }
      features.push({
        ...record.feature,
        properties: {
          ...record.feature.properties,
          ...(item.presentation?.color ? { markerColor: item.presentation.color } : {}),
          ...(Number.isFinite(item.presentation?.radius)
            ? { markerRadius: item.presentation.radius }
            : {}),
          [FEATURE_PROPERTIES.sourceBlockUids]: item.provenance.map(
            ({ sourceBlockUid }) => sourceBlockUid,
          ),
          [FEATURE_PROPERTIES.originBlockUids]: item.provenance.map(
            ({ originBlockUid }) => originBlockUid,
          ),
        },
      });
    }

    return {
      definition: source.definition,
      sourceItems: source.items,
      sourceWatchUids: source.watchUids,
      attributeWatchUids: [...attributeWatchUids],
      resolved,
      featureCollection: { type: "FeatureCollection", features },
      presentation: source.presentation,
      layers: source.layers ?? [],
      assets: [...assets.values()],
      diagnostics: uniqueDiagnostics(diagnostics),
      counts: {
        sources: source.items.length,
        mapped: features.length,
        unmapped: Math.max(0, source.items.length - features.length),
      },
    };
  }

  return { compile };
}
