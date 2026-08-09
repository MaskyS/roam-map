const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/u;

function decimalText(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  if (Object.is(value, -0)) return "0";
  const source = String(value);
  if (!/[eE]/u.test(source)) return source;

  const [coefficient, exponentText] = source.toLowerCase().split("e");
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith("-");
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [integer, fraction = ""] = unsigned.split(".");
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  const expanded = decimalIndex <= 0
    ? `0.${"0".repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return negative ? `-${expanded}` : expanded;
}

function decimalNumber(value, label) {
  if (!DECIMAL.test(value)) {
    throw new Error(`${label} must be a decimal number without an exponent.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
  return number;
}

function boundedCoordinate(value, { label, min, max }) {
  const number = decimalNumber(value, label);
  if (number < min || number > max) {
    throw new Error(`${label} must be from ${min} to ${max}.`);
  }
  return number;
}

export function parseGeoUri(raw) {
  if (typeof raw !== "string") {
    throw new Error("Coordinates must be a geo URI string.");
  }
  const source = raw.trim();
  if (!/^geo:/iu.test(source)) {
    throw new Error("Coordinates must start with geo:.");
  }

  const [coordinatePart, ...parameterParts] = source.slice(4).split(";");
  const coordinates = coordinatePart.split(",");
  if (coordinates.length !== 2) {
    throw new Error("Coordinates must contain exactly latitude and longitude.");
  }
  const lat = boundedCoordinate(coordinates[0], {
    label: "Latitude",
    min: -90,
    max: 90,
  });
  const lon = boundedCoordinate(coordinates[1], {
    label: "Longitude",
    min: -180,
    max: 180,
  });

  let uncertainty = null;
  const seen = new Set();
  for (const part of parameterParts) {
    const separator = part.indexOf("=");
    if (separator <= 0 || separator === part.length - 1) {
      throw new Error("Every geo URI parameter must have a name and value.");
    }
    const name = part.slice(0, separator).toLowerCase();
    const value = part.slice(separator + 1);
    if (seen.has(name)) throw new Error(`The ${name} parameter may appear only once.`);
    seen.add(name);
    if (name === "crs") {
      if (value.toLowerCase() !== "wgs84") {
        throw new Error("Only the WGS84 coordinate system is supported.");
      }
      continue;
    }
    if (name === "u") {
      uncertainty = decimalNumber(value, "Uncertainty");
      if (uncertainty < 0) throw new Error("Uncertainty cannot be negative.");
      continue;
    }
    throw new Error(`The ${name} geo URI parameter is not supported.`);
  }

  return { lat, lon, uncertainty };
}

export function formatGeoUri({ lat, lon, uncertainty = null }) {
  const latitude = decimalText(lat, "Latitude");
  const longitude = decimalText(lon, "Longitude");
  boundedCoordinate(latitude, { label: "Latitude", min: -90, max: 90 });
  boundedCoordinate(longitude, { label: "Longitude", min: -180, max: 180 });
  if (uncertainty == null) return `geo:${latitude},${longitude}`;
  const uncertaintyText = decimalText(uncertainty, "Uncertainty");
  if (uncertainty < 0) throw new Error("Uncertainty cannot be negative.");
  return `geo:${latitude},${longitude};u=${uncertaintyText}`;
}

export function isGeoUri(value) {
  return typeof value === "string" && /^geo:/iu.test(value.trim());
}
