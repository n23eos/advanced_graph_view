/**
 * Plugin data files under .obsidian/plugins/graph-insight/data/.
 * All reads tolerate missing/corrupt files (return null) — the plugin
 * must start cleanly on first run and after manual file deletion.
 */
import type { App } from "obsidian";
import { normalizeUsageLog, type UsageLog } from "./UsageTracker";
import { normalizeSnapshotStore, type SnapshotStore } from "./graphSnapshots";

/** [x, y] in old saves, [x, y, z] since the pseudo-3D update. */
export type PositionMap = Record<string, [number, number] | [number, number, number]>;

/** What positions.json holds since pins became persistent. Pins are stored as
 *  note paths, not node ids: ids are assigned per build and shift whenever the
 *  vault gains or loses a note. */
export interface SavedPositions {
	positions: PositionMap;
	pins: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCoordinates(raw: unknown): [number, number] | [number, number, number] | null {
	if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 3)) return null;
	if (!raw.every((value) =>
		typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
		return null;
	}
	return raw.length === 2
		? [raw[0] as number, raw[1] as number]
		: [raw[0] as number, raw[1] as number, raw[2] as number];
}

function normalizePositionMap(raw: unknown): PositionMap | null {
	if (!isRecord(raw)) return null;
	const positions: PositionMap = {};
	for (const [path, value] of Object.entries(raw)) {
		const coordinates = normalizeCoordinates(value);
		if (!coordinates) continue;
		Object.defineProperty(positions, path, {
			value: coordinates,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return positions;
}

/**
 * Accept both shapes positions.json has ever had: the current envelope, and the
 * bare path→coords map written before pins existed. Returns null for anything
 * that is not a usable object, so a corrupt file starts the plugin clean.
 */
export function normalizeSavedPositions(raw: unknown): SavedPositions | null {
	if (!isRecord(raw)) return null;

	const candidate = raw as { positions?: unknown; pins?: unknown };
	// A legacy map may contain a note literally named "positions". Treat that
	// key as the envelope only when its value is a map or the sibling pins key
	// makes the current shape unambiguous.
	const isEnvelope = isRecord(candidate.positions) || Object.hasOwn(raw, "pins");
	const positions = normalizePositionMap(isEnvelope ? candidate.positions : raw);
	if (!positions) return null;
	if (!isEnvelope) return { positions, pins: [] };

	const pins: string[] = [];
	const seen = new Set<string>();
	if (Array.isArray(candidate.pins)) {
		for (const path of candidate.pins) {
			if (typeof path !== "string" || seen.has(path) || !Object.hasOwn(positions, path)) continue;
			seen.add(path);
			pins.push(path);
		}
	}
	return { positions, pins };
}

export class PluginDataStore {
	constructor(
		private readonly app: App,
		private readonly pluginDir: string
	) {}

	private get dataDir(): string {
		return `${this.pluginDir}/data`;
	}

	private async readJson<T>(fileName: string): Promise<T | null> {
		const path = `${this.dataDir}/${fileName}`;
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return JSON.parse(await this.app.vault.adapter.read(path)) as T;
		} catch (error) {
			console.error(`Advanced Graph View: failed to read ${fileName}`, error);
			return null;
		}
	}

	private async writeJson(fileName: string, data: unknown): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(this.dataDir))) {
				await this.app.vault.adapter.mkdir(this.dataDir);
			}
			await this.app.vault.adapter.write(`${this.dataDir}/${fileName}`, JSON.stringify(data));
		} catch (error) {
			console.error(`Advanced Graph View: failed to write ${fileName}`, error);
		}
	}

	/**
	 * A usage log that fails validation is moved aside before the plugin starts
	 * over, so a shape problem never silently erases years of history: the file
	 * is still there to inspect or hand back.
	 */
	async loadUsage(): Promise<UsageLog | null> {
		const raw = await this.readJson<unknown>("usage.json");
		if (raw === null) return null;
		const log = normalizeUsageLog(raw);
		if (log === null) {
			await this.quarantine("usage.json");
			return null;
		}
		return log;
	}

	/** Rename a damaged file to `<name>.corrupt` instead of deleting it. */
	private async quarantine(fileName: string): Promise<void> {
		const path = `${this.dataDir}/${fileName}`;
		const backup = `${path}.corrupt`;
		try {
			if (await this.app.vault.adapter.exists(backup)) {
				await this.app.vault.adapter.remove(backup);
			}
			await this.app.vault.adapter.rename(path, backup);
			console.error(`Advanced Graph View: ${fileName} was unreadable, moved to ${backup}`);
		} catch (error) {
			console.error(`Advanced Graph View: failed to set aside ${fileName}`, error);
		}
	}

	saveUsage(log: UsageLog): Promise<void> {
		return this.writeJson("usage.json", log);
	}

	async loadPositions(): Promise<SavedPositions | null> {
		return normalizeSavedPositions(await this.readJson<unknown>("positions.json"));
	}

	savePositions(saved: SavedPositions): Promise<void> {
		return this.writeJson("positions.json", saved);
	}

	/** F-10 history. A corrupt file is quarantined (never deleted) and the
	 *  history simply starts over — the rest of the plugin keeps working. */
	async loadSnapshots(): Promise<SnapshotStore | null> {
		const raw = await this.readJson<unknown>("snapshots.json");
		if (raw === null) return null;
		const store = normalizeSnapshotStore(raw);
		if (store === null) {
			await this.quarantine("snapshots.json");
			return null;
		}
		return store;
	}

	saveSnapshots(store: SnapshotStore): Promise<void> {
		return this.writeJson("snapshots.json", store);
	}

	/** "Reset all plugin data" clears the history; "reset settings" must not. */
	async removeSnapshots(): Promise<void> {
		const path = `${this.dataDir}/snapshots.json`;
		try {
			if (await this.app.vault.adapter.exists(path)) {
				await this.app.vault.adapter.remove(path);
			}
		} catch (error) {
			console.error("Advanced Graph View: failed to remove snapshots.json", error);
		}
	}
}
