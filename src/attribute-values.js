export function list(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function firstRef(value) {
  return list(value)[0] ?? null;
}

export function refUid(value) {
  return Array.isArray(value) && typeof value[1] === "string" ? value[1] : null;
}

export function svPart(sv, key) {
  return sv?.[key] ?? sv?.[`:${key}`];
}

export function displayAttributeValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return (
    value?.[":node/title"] ??
    value?.[":block/string"] ??
    value?.[":harc/v-string"] ??
    value?.[":harc.text/string"] ??
    null
  );
}

export function legacyOwnTriples(entity) {
  const uid = entity?.[":block/uid"];
  const triples = entity?.[":entity/attrs"];
  if (!uid || !Array.isArray(triples)) return [];
  return triples.filter(
    (triple) =>
      Array.isArray(triple) &&
      triple.length === 3 &&
      refUid(svPart(triple[0], "value")) === uid,
  );
}

export function currentAttributeRelations(entity, attributeTitle) {
  return list(entity?.[":harc/_e"]).filter(
    (harc) => firstRef(harc?.[":harc/a"])?.[":node/title"] === attributeTitle,
  );
}

export function currentAttributeValues(entity, attributeTitle) {
  return currentAttributeRelations(entity, attributeTitle).flatMap((harc) =>
    list(harc?.[":harc/v"])
      .map(displayAttributeValue)
      .filter((value) => value != null),
  );
}

export function legacyAttributeRelations(entity, attributeUid) {
  if (!attributeUid) return [];
  return legacyOwnTriples(entity).filter(
    (triple) => refUid(svPart(triple[1], "value")) === attributeUid,
  );
}

export function legacyAttributeValues(entity, attributeUid) {
  return legacyAttributeRelations(entity, attributeUid)
    .map((triple) => svPart(triple[2], "value"))
    .filter((value) => value != null);
}

export function attributeSourceUid(relation) {
  return firstRef(relation?.[":harc/a-source"])?.[":block/uid"] ?? null;
}
