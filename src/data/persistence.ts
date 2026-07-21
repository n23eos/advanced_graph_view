/**
 * Plugin data files under .obsidian/plugins/graph-insight/data/.
 * All reads tolerate missing/corrupt files (return null) — the plugin
 * must start cleanly on first run and after manual file deletion.
 */
import type { App } from "obsidian";
import type { UsageLog } from "./UsageTracker";

/** [x, y] in old saves, [x, y, z] since the pseudo-3D update. */
export type PositionMap = Record<string, [number, number] | [number, number, number]>;

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
			console.error(`Graph Insight: failed to read ${fileName}`, error);
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
			console.error(`Graph Insight: failed to write ${fileName}`, error);
		}
	}

	loadUsage(): Promise<UsageLog | null> {
		return this.readJson<UsageLog>("usage.json");
	}

	saveUsage(log: UsageLog): Promise<void> {
		return this.writeJson("usage.json", log);
	}

	loadPositions(): Promise<PositionMap | null> {
		return this.readJson<PositionMap>("positions.json");
	}

	savePositions(positions: PositionMap): Promise<void> {
		return this.writeJson("positions.json", positions);
	}
}
