import { propertyKeyFromMetric, type NodeFacts } from "./metrics";

type PropertyMap = NonNullable<NodeFacts["properties"]>;

function normalizeScalar(value: unknown): string | null {
	if (typeof value === "string") {
		const normalized = value.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
	if (typeof value === "boolean") return String(value);
	return null;
}

export function normalizePropertyKey(key: string): string {
	return key.trim().toLowerCase();
}

export function normalizeFrontmatterProperties(raw: unknown): PropertyMap | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
	const properties = Object.create(null) as Record<string, readonly string[]>;
	for (const [rawKey, rawValue] of Object.entries(raw)) {
		const key = normalizePropertyKey(rawKey);
		if (!key || key === "position") continue;
		const candidates = Array.isArray(rawValue) ? rawValue : [rawValue];
		const values = candidates.map(normalizeScalar).filter((value): value is string => value !== null);
		if (values.length === 0) continue;
		const previous = properties[key] ?? [];
		properties[key] = [...previous, ...values];
	}
	return Object.keys(properties).length > 0 ? properties : undefined;
}

export function collectPropertyKeys(facts: readonly NodeFacts[], activeMetric: string | null = null): string[] {
	const counts = new Map<string, number>();
	for (const fact of facts) {
		for (const [key, values] of Object.entries(fact.properties ?? {})) {
			if (values.length > 0) counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	const keys = [...counts]
		.sort(([leftKey, leftCount], [rightKey, rightCount]) =>
			rightCount - leftCount || leftKey.localeCompare(rightKey))
		.map(([key]) => key);
	const activeKey = activeMetric ? propertyKeyFromMetric(activeMetric) : null;
	if (activeKey && !counts.has(activeKey)) keys.push(activeKey);
	return keys;
}
