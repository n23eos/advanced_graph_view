/**
 * Plugin-level semantic engine: owns the embed worker and the vector index,
 * runs full + incremental indexing, caches the similar-pair list.
 * Views subscribe via callbacks for status and pair updates.
 */
import { TFile, debounce, type App } from "obsidian";
import embedWorkerSource from "worker:./embed.worker";
import type { EmbedRequest, EmbedResponse } from "./embed.worker";
import { EmbeddingIndex, type IndexMeta } from "./EmbeddingIndex";
import { contentHash, extractEmbeddingText } from "./textExtract";
import type { PluginDataStore } from "../data/persistence";

const DIM = 384;
const BATCH_SIZE = 16;
const REINDEX_DEBOUNCE_MS = 10_000;
/** Pairs are computed once at this floor; the UI slider filters higher. */
const PAIR_FLOOR = 0.5;

export interface SemanticPair {
	pathA: string;
	pathB: string;
	similarity: number;
}

export interface SemanticStatus {
	state: "off" | "loading-model" | "indexing" | "pairing" | "ready" | "error";
	done: number;
	total: number;
	message?: string;
}

type StatusListener = (status: SemanticStatus) => void;

export class SemanticService {
	private worker: Worker | null = null;
	private blobUrl: string | null = null;
	private index = new EmbeddingIndex(DIM);
	private pairs: SemanticPair[] = [];
	private pairPaths: string[] = [];
	private status: SemanticStatus = { state: "off", done: 0, total: 0 };
	private listeners = new Set<StatusListener>();
	private pendingEmbeds = new Map<number, string>();
	private nextRequestId = 0;
	private queue: TFile[] = [];
	private busy = false;
	private similarResolve: ((result: { paths: string[]; sims: number[] }) => void) | null = null;

	private reindexDebounced = debounce(() => void this.processQueue(), REINDEX_DEBOUNCE_MS, true);

	constructor(
		private readonly app: App,
		private readonly dataStore: PluginDataStore
	) {}

	onStatus(listener: StatusListener): () => void {
		this.listeners.add(listener);
		listener(this.status);
		return () => this.listeners.delete(listener);
	}

	getStatus(): SemanticStatus {
		return this.status;
	}

	getPairs(): SemanticPair[] {
		return this.pairs;
	}

	private setStatus(status: SemanticStatus): void {
		this.status = status;
		for (const listener of this.listeners) listener(status);
	}

	/** Called after the user consented. Downloads model on first run. */
	async enable(): Promise<void> {
		if (this.worker) return;
		const blob = new Blob([embedWorkerSource], { type: "text/javascript" });
		this.blobUrl = URL.createObjectURL(blob);
		this.worker = new Worker(this.blobUrl);
		this.worker.onmessage = (event: MessageEvent<EmbedResponse>) => this.handleMessage(event.data);

		this.setStatus({ state: "loading-model", done: 0, total: 0 });
		await this.loadPersistedIndex();
		this.post({ type: "init" });
	}

	disable(): void {
		this.worker?.terminate();
		this.worker = null;
		if (this.blobUrl) {
			URL.revokeObjectURL(this.blobUrl);
			this.blobUrl = null;
		}
		this.setStatus({ state: "off", done: 0, total: 0 });
	}

	private post(message: EmbedRequest, transfer?: Transferable[]): void {
		this.worker?.postMessage(message, transfer ?? []);
	}

	private async loadPersistedIndex(): Promise<void> {
		const meta = await this.dataStore.readJsonFile<IndexMeta>("embeddings-index.json");
		const vectors = await this.dataStore.readBinaryFile("embeddings.bin");
		if (meta && vectors && meta.dim === DIM && vectors.byteLength === meta.paths.length * DIM * 4) {
			this.index = EmbeddingIndex.deserialize(meta, vectors);
		}
	}

	private async persistIndex(): Promise<void> {
		const { meta, vectors } = this.index.serialize();
		await this.dataStore.writeJsonFile("embeddings-index.json", meta);
		await this.dataStore.writeBinaryFile("embeddings.bin", vectors);
	}

	private handleMessage(message: EmbedResponse): void {
		switch (message.type) {
			case "model-progress":
				this.setStatus({ state: "loading-model", done: message.loaded, total: message.total });
				break;
			case "ready":
				void this.startFullIndex();
				break;
			case "embedded":
				this.handleEmbedded(message.ids, message.vectors);
				break;
			case "pairs-progress":
				this.setStatus({ state: "pairing", done: message.done, total: message.total });
				break;
			case "pairs-result":
				this.handlePairs(message.pairs);
				break;
			case "similar-result":
				this.similarResolve?.({
					paths: Array.from(message.rows).map((row) => this.pairPaths[row]),
					sims: Array.from(message.sims),
				});
				this.similarResolve = null;
				break;
			case "error":
				console.error("Graph Insight embed worker:", message.message);
				this.setStatus({ state: "error", done: 0, total: 0, message: message.message });
				// Unblock any in-flight waiters so processQueue()/similar() can't hang.
				this.embedBatchResolve?.();
				this.embedBatchResolve = null;
				this.similarResolve?.({ paths: [], sims: [] });
				this.similarResolve = null;
				break;
		}
	}

	private async startFullIndex(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		this.queue = [];
		for (const file of files) {
			const hash = this.index.getHash(file.path);
			if (hash === null) this.queue.push(file);
		}
		// Drop index entries for deleted files.
		const alive = new Set(files.map((f) => f.path));
		for (const path of this.index.packAll().paths) {
			if (!alive.has(path)) this.index.remove(path);
		}
		await this.processQueue();
	}

	/** Re-embed one file after edits (debounced by the caller). */
	scheduleReindex(file: TFile): void {
		if (!this.worker) return;
		if (!this.queue.some((f) => f.path === file.path)) this.queue.push(file);
		this.reindexDebounced();
	}

	handleRename(oldPath: string, newPath: string): void {
		this.index.rename(oldPath, newPath);
		// New array + new objects: consumers may be iterating the old one.
		this.pairs = this.pairs.map((pair) => ({
			...pair,
			pathA: pair.pathA === oldPath ? newPath : pair.pathA,
			pathB: pair.pathB === oldPath ? newPath : pair.pathB,
		}));
	}

	handleDelete(path: string): void {
		this.index.remove(path);
		this.pairs = this.pairs.filter((p) => p.pathA !== path && p.pathB !== path);
	}

	private async processQueue(): Promise<void> {
		if (this.busy || !this.worker) return;
		this.busy = true;
		const total = this.queue.length;
		let done = 0;

		while (this.queue.length > 0) {
			const batch = this.queue.splice(0, BATCH_SIZE);
			const ids: number[] = [];
			const texts: string[] = [];
			for (const file of batch) {
				let raw = "";
				try {
					raw = await this.app.vault.cachedRead(file);
				} catch {
					continue;
				}
				const text = extractEmbeddingText(file.basename, raw);
				const hash = contentHash(text);
				if (this.index.getHash(file.path) === hash) continue;
				const id = this.nextRequestId++;
				this.pendingEmbeds.set(id, file.path);
				// Hash stored on arrival; remember it alongside the path.
				this.pendingHashes.set(id, hash);
				ids.push(id);
				texts.push(text);
			}
			if (ids.length > 0) {
				await new Promise<void>((resolve) => {
					this.embedBatchResolve = resolve;
					this.post({ type: "embed", ids, texts });
				});
			}
			done += batch.length;
			this.setStatus({ state: "indexing", done, total });
		}

		this.busy = false;
		await this.persistIndex();
		this.recomputePairs();
	}

	private pendingHashes = new Map<number, number>();
	private embedBatchResolve: (() => void) | null = null;

	private handleEmbedded(ids: number[], vectors: Float32Array): void {
		for (let i = 0; i < ids.length; i++) {
			const path = this.pendingEmbeds.get(ids[i]);
			const hash = this.pendingHashes.get(ids[i]);
			if (path === undefined || hash === undefined) continue;
			this.pendingEmbeds.delete(ids[i]);
			this.pendingHashes.delete(ids[i]);
			this.index.set(path, hash, vectors.slice(i * DIM, (i + 1) * DIM));
		}
		this.embedBatchResolve?.();
		this.embedBatchResolve = null;
	}

	private recomputePairs(): void {
		const { paths, matrix } = this.index.packAll();
		this.pairPaths = paths;
		if (paths.length < 2) {
			this.setStatus({ state: "ready", done: this.index.size, total: this.index.size });
			return;
		}
		this.setStatus({ state: "pairing", done: 0, total: paths.length });
		this.post({ type: "set-matrix", matrix, count: paths.length }, [matrix.buffer]);
		this.post({ type: "pairs", threshold: PAIR_FLOOR });
	}

	private handlePairs(flat: Float32Array): void {
		const pairs: SemanticPair[] = [];
		for (let i = 0; i < flat.length; i += 3) {
			pairs.push({
				pathA: this.pairPaths[flat[i]],
				pathB: this.pairPaths[flat[i + 1]],
				similarity: flat[i + 2],
			});
		}
		pairs.sort((a, b) => b.similarity - a.similarity);
		this.pairs = pairs;
		this.setStatus({ state: "ready", done: this.index.size, total: this.index.size });
	}

	/** Drop the index and re-embed the whole vault. */
	async rebuild(): Promise<void> {
		if (!this.worker) return;
		this.index = new EmbeddingIndex(DIM);
		this.pairs = [];
		await this.startFullIndex();
	}

	/** Top-k semantically similar notes for a path. */
	similar(path: string, k: number): Promise<{ paths: string[]; sims: number[] }> {
		const row = this.pairPaths.indexOf(path);
		if (row < 0 || !this.worker) return Promise.resolve({ paths: [], sims: [] });
		const query = new Promise<{ paths: string[]; sims: number[] }>((resolve) => {
			this.similarResolve = resolve;
			this.post({ type: "similar", row, k });
		});
		const timeout = new Promise<{ paths: string[]; sims: number[] }>((resolve) =>
			window.setTimeout(() => resolve({ paths: [], sims: [] }), 10_000)
		);
		return Promise.race([query, timeout]);
	}
}
