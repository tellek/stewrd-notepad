// Adds keys from the repo's settings.json that the deployed one lacks; never changes existing values.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [source, target] = process.argv.slice(2);
const defaults = JSON.parse(readFileSync(source, "utf8"));
const current = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
const merged = { ...defaults, ...current };
if (JSON.stringify(merged) !== JSON.stringify(current)) writeFileSync(target, JSON.stringify(merged, null, 2) + "\n");
