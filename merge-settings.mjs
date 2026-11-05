// Adds keys (including nested ones) from the repo's settings.json that the deployed one lacks; never changes existing values.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function addMissing(defaults, current) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = value;
    else if (isObject(value) && isObject(merged[key])) merged[key] = addMissing(value, merged[key]);
  }
  return merged;
}

const [source, target] = process.argv.slice(2);
const defaults = JSON.parse(readFileSync(source, "utf8"));
const current = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
const merged = addMissing(defaults, current);
if (JSON.stringify(merged) !== JSON.stringify(current)) writeFileSync(target, JSON.stringify(merged, null, 2) + "\n");
