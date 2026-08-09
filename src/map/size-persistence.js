// A completed two-dimensional resize is one presentation edit. Keep it in one
// readable block so Roam never observes a half-saved width/height pair.
import { MAP_SIZE_ATTRIBUTE, normalizeMapSizeValue } from "./options.js";

function uniqueSourceUids(sourceUids) {
  return [...new Set((sourceUids ?? []).filter(Boolean))];
}

function oneSourceUid(sourceUids) {
  const uids = uniqueSourceUids(sourceUids);
  if (uids.length > 1) {
    throw new Error(
      "map/size appears more than once. Remove the duplicate values before resizing.",
    );
  }
  return uids[0] ?? null;
}

export function mapSizeBlockString(size) {
  const normalized = normalizeMapSizeValue(size);
  if (!normalized) throw new Error("The map size is outside the supported range.");
  const maxWidth = normalized.maxWidth ?? "auto";
  const height = normalized.height ?? "auto";
  return `${MAP_SIZE_ATTRIBUTE}:: ${maxWidth} × ${height}`;
}

export async function persistMapSize({ api, mapUid, size, sourceUids = [] }) {
  const string = mapSizeBlockString(size);
  const sourceUid = oneSourceUid(sourceUids);
  if (sourceUid) {
    await api.updateBlockString(sourceUid, string);
    return sourceUid;
  }
  return api.createChildBlock({ parentUid: mapUid, order: "last", string });
}

export async function clearMapSize({ api, sourceUids = [] }) {
  const sourceUid = oneSourceUid(sourceUids);
  if (!sourceUid) return false;
  await api.deleteBlock(sourceUid);
  return true;
}

export const __test = { oneSourceUid, uniqueSourceUids };
