export function parseMapDefinitions(blockString) {
  const source = String(blockString ?? "");
  const definitions = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("{{", cursor);
    if (start < 0) break;
    let index = start + 2;
    while (/\s/u.test(source[index] ?? "")) index += 1;
    const remainder = source.slice(index);
    const token = remainder.match(/^(?:map\b|\[\[\s*map\s*\]\])/iu)?.[0] ?? null;
    if (!token) {
      cursor = start + 2;
      continue;
    }
    index += token.length;
    while (/\s/u.test(source[index] ?? "")) index += 1;

    let argument = null;
    if (source.startsWith("}}", index)) {
      const end = index + 2;
      definitions.push({ raw: source.slice(start, end), argument, start, end });
      cursor = end;
      continue;
    }
    if (source[index] !== ":") {
      cursor = start + 2;
      continue;
    }
    index += 1;
    while (/\s/u.test(source[index] ?? "")) index += 1;
    const argumentStart = index;
    let braceDepth = 0;
    let quote = null;
    let escaped = false;
    let end = -1;
    while (index < source.length) {
      const character = source[index];
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (quote && character === "\\") {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = quote === character ? null : quote ?? character;
        index += 1;
        continue;
      }
      if (!quote && character === "{") {
        braceDepth += 1;
        index += 1;
        continue;
      }
      if (!quote && character === "}") {
        if (braceDepth > 0) {
          braceDepth -= 1;
          index += 1;
          continue;
        }
        if (source[index + 1] === "}") {
          end = index + 2;
          break;
        }
      }
      index += 1;
    }
    if (end < 0) {
      cursor = start + 2;
      continue;
    }
    definitions.push({
      raw: source.slice(start, end),
      argument: source.slice(argumentStart, end - 2).trim() || null,
      start,
      end,
    });
    cursor = end;
  }
  return definitions;
}

export function isMapDefinition(blockString) {
  return parseMapDefinitions(blockString).length > 0;
}
