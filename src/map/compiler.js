// The compiler is the join point for every source adapter: it merges entity identity,
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
    key: `render.unsupported-geometry:${item.identityKind}:${item.entityUid}`,
    code: "render.unsupported-geometry",
    severity: "warning",
    entityUid: item.entityUid,
    identityKind: item.identityKind,
    entityTitle: record.label ?? null,
    sourceBlockUid: item.provenance[0]?.sourceBlockUid ?? null,
    message: `${record.label} has valid ${record.feature.geometry.type} geometry, but this milestone renders points only.`,
  };
}

function mergeContributions(contributions = []) {
  const items = new Map();
  for (const contribution of contributions) {
    if (!contribution?.entityUid || !contribution?.identityKind) continue;
    const identity = `${contribution.identityKind}:${contribution.entityUid}`;
    const provenance = Array.isArray(contribution.provenance)
      ? contribution.provenance
      : [contribution.provenance].filter(Boolean);
    const existing = items.get(identity);
    if (existing) {
      existing.provenance.push(...provenance);
      existing.allowInlineCoordinates ||= Boolean(contribution.allowInlineCoordinates);
      continue;
    }
    items.set(identity, {
      identityKind: contribution.identityKind,
      entityUid: contribution.entityUid,
      title: contribution.title ?? null,
      allowInlineCoordinates: Boolean(contribution.allowInlineCoordinates),
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
      key: `place.resolve-failed:${item.identityKind}:${item.entityUid}`,
      code: "place.resolve-failed",
      severity: "error",
      entityUid: item.entityUid,
      identityKind: item.identityKind,
      entityTitle: item.title ?? null,
      sourceBlockUid: item.provenance[0]?.sourceBlockUid ?? null,
      message: `The location source could not be read: ${error?.message ?? String(error)}`,
    },
  };
}

async function resolvePlaces(items, placeResolver) {
  if (typeof placeResolver.resolveEntities === "function") {
    try {
      const records = await placeResolver.resolveEntities(items);
      return items.map((item, index) => ({ item, record: records[index] }));
    } catch (error) {
      return items.map((item) => resolveFailure(item, error));
    }
  }
  return Promise.all(
    items.map(async (item) => {
      if (item.identityKind !== "page") {
        return resolveFailure(
          item,
          new Error("The configured location resolver does not support block sources."),
        );
      }
      try {
        return {
          item,
          record: await placeResolver.resolvePage(item.entityUid),
        };
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
      const entityTitle = record.label ?? item.title ?? null;
      diagnostics.push(
        ...record.diagnostics.map((diagnostic) =>
          diagnostic.entityUid === item.entityUid && diagnostic.entityTitle == null
            ? { ...diagnostic, entityTitle }
            : diagnostic,
        ),
      );
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
      optionSourceUids: source.optionSourceUids ?? {},
      layers: source.layers ?? [],
      markerClick: source.markerClick ?? null,
      resultsList: source.resultsList ?? null,
      dynamicSources: source.dynamicSources ?? [],
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
