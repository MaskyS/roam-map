// The compiler is the join point for every source adapter: it merges page identity,
// bulk-resolves Roam records, and emits one renderer-independent map plan.
import { FEATURE_PROPERTIES } from "./feature-properties.js";

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

function mergeContributions(contributions = []) {
  const items = new Map();
  for (const contribution of contributions) {
    if (!contribution?.pageUid) continue;
    const provenance = Array.isArray(contribution.provenance)
      ? contribution.provenance
      : [contribution.provenance].filter(Boolean);
    const existing = items.get(contribution.pageUid);
    if (existing) {
      existing.provenance.push(...provenance);
      continue;
    }
    items.set(contribution.pageUid, {
      kind: "page",
      pageUid: contribution.pageUid,
      title: contribution.title ?? null,
      provenance,
    });
  }
  return [...items.values()];
}

function resolveFailure(item, error) {
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

async function resolvePlaces(items, placeResolver) {
  if (typeof placeResolver.resolvePages === "function") {
    try {
      const records = await placeResolver.resolvePages(items.map(({ pageUid }) => pageUid));
      return items.map((item, index) => ({ item, record: records[index] }));
    } catch (error) {
      return items.map((item) => resolveFailure(item, error));
    }
  }
  return Promise.all(
    items.map(async (item) => {
      try {
        return { item, record: await placeResolver.resolvePage(item.pageUid) };
      } catch (error) {
        return resolveFailure(item, error);
      }
    }),
  );
}

export function createMapCompiler({ sourceCompiler, placeResolver }) {
  async function compile(mapUid) {
    const source = await sourceCompiler.compile(mapUid);
    const items = mergeContributions(source.contributions);
    const records = await resolvePlaces(items, placeResolver);

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
      sourceItems: items,
      sourceWatchUids: source.watchUids,
      attributeWatchUids: [...attributeWatchUids],
      resolved,
      featureCollection: { type: "FeatureCollection", features },
      options: source.options,
      layers: source.layers ?? [],
      markerClick: source.markerClick ?? null,
      assets: [...assets.values()],
      diagnostics: uniqueDiagnostics(diagnostics),
      counts: {
        sources: items.length,
        mapped: features.length,
        unmapped: Math.max(0, items.length - features.length),
      },
    };
  }

  return { compile };
}

export const __test = { mergeContributions, resolvePlaces };
