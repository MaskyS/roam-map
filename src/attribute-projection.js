import {
  displayAttributeValue,
  firstRef,
  legacyOwnTriples,
  list,
  refUid,
  svPart,
} from "./attribute-values.js";
import { COMPILER_PROPERTY_PREFIX } from "./map-contract.js";

const IMAGE_MARKDOWN = /^!\[[^\]]*\]\((https?:\/\/[\s\S]+)\)$/u;

function exactMetaChildren(entity) {
  return list(entity?.[":block/children"]).filter(
    (child) => child?.[":block/string"] === "roam/meta::",
  );
}

function hashText(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function imageAssetId(sourceUrl) {
  const value = String(sourceUrl);
  return `roam-map:image:${hashText(value, 2166136261)}${hashText(value, 3335557771)}`;
}

export function imageUrlFromMarkdown(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(IMAGE_MARKDOWN);
  if (!match) return null;
  try {
    const url = new URL(match[1].trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function projectionDiagnostic({ code, pageUid, attributeTitle, message, detail = null }) {
  return {
    key: [code, pageUid, attributeTitle, detail].filter(Boolean).join(":"),
    code,
    severity: "warning",
    pageUid,
    field: attributeTitle,
    message,
    ...(detail ? { detail } : {}),
  };
}

function normalizeValue(value) {
  const display = displayAttributeValue(value);
  if (typeof display === "string") return display.trim();
  if (typeof display === "boolean") return display;
  if (typeof display === "number" && Number.isFinite(display)) return display;
  return null;
}

function distinct(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${typeof value}:${JSON.stringify(value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentGroups(entity) {
  const groups = new Map();
  for (const source of [entity, ...exactMetaChildren(entity)]) {
    for (const relation of list(source?.[":harc/_e"])) {
      const attribute = firstRef(relation?.[":harc/a"]);
      const title = attribute?.[":node/title"];
      if (typeof title !== "string" || !title) continue;
      const group = groups.get(title) ?? {
        title,
        attributeUid: attribute?.[":block/uid"] ?? null,
        values: [],
      };
      group.values.push(...list(relation?.[":harc/v"]));
      groups.set(title, group);
    }
  }
  return groups;
}

function legacyGroups(entity, attributeTitlesByUid) {
  const groups = new Map();
  for (const source of [entity, ...exactMetaChildren(entity)]) {
    for (const triple of legacyOwnTriples(source)) {
      const attributeUid = refUid(svPart(triple[1], "value"));
      const title = attributeTitlesByUid.get(attributeUid);
      if (!attributeUid || !title) continue;
      const group = groups.get(title) ?? { title, attributeUid, values: [] };
      group.values.push(svPart(triple[2], "value"));
      groups.set(title, group);
    }
  }
  return groups;
}

export function legacyAttributeUids(entity) {
  const uids = new Set();
  for (const source of [entity, ...exactMetaChildren(entity)]) {
    for (const triple of legacyOwnTriples(source)) {
      const uid = refUid(svPart(triple[1], "value"));
      if (uid) uids.add(uid);
    }
  }
  return [...uids];
}

export function projectAttributes(entity, { attributeTitlesByUid = new Map() } = {}) {
  const pageUid = entity?.[":block/uid"] ?? "unknown";
  const properties = {};
  const diagnostics = [];
  const assets = [];
  const attributeUids = new Set();
  const current = currentGroups(entity);
  const legacy = legacyGroups(entity, attributeTitlesByUid);
  const titles = new Set([...current.keys(), ...legacy.keys()]);

  for (const title of titles) {
    const group = current.get(title) ?? legacy.get(title);
    if (group.attributeUid) attributeUids.add(group.attributeUid);
    if (title === "roam/meta") continue;
    if (title.startsWith(COMPILER_PROPERTY_PREFIX)) {
      diagnostics.push(
        projectionDiagnostic({
          code: "attribute.reserved-title",
          pageUid,
          attributeTitle: title,
          message: `The ${COMPILER_PROPERTY_PREFIX} property prefix is reserved for values owned by Roam Map.`,
        }),
      );
      continue;
    }

    const values = distinct(group.values.map(normalizeValue).filter((value) => value != null));
    if (values.length === 0) {
      if (group.values.length > 0) {
        diagnostics.push(
          projectionDiagnostic({
            code: "attribute.unsupported-value",
            pageUid,
            attributeTitle: title,
            message: `${title} has no text, number, boolean, or page-title value that can be projected to GeoJSON.`,
          }),
        );
      }
      continue;
    }

    const projected = values.map((value) => {
      const sourceUrl = imageUrlFromMarkdown(value);
      if (!sourceUrl) return value;
      const id = imageAssetId(sourceUrl);
      assets.push({
        id,
        sourceUrl,
        attributeTitle: title,
        attributeUid: group.attributeUid,
        pageUid,
        width: 64,
        height: 64,
        pixelRatio: 2,
      });
      return id;
    });
    properties[title] = projected.length === 1 ? projected[0] : projected;
  }

  return { properties, diagnostics, assets, attributeUids: [...attributeUids] };
}

export const __test = { currentGroups, exactMetaChildren, legacyGroups, normalizeValue };
