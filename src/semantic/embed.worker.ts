/**
 * Embedding worker: transformers.js (all-MiniLM-L6-v2, quantized) inference
 * plus brute-force cosine similarity over the vector matrix. The model and
 * onnx wasm runtime are downloaded on first use (user consented on enable)
 * and cached by the browser Cache API — subsequent runs are fully offline.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;
const PAIR_CHUNK_ROWS = 128;

env.allowLocalModels = false;

export type EmbedRequest =
	| { type: "init" }
	| { type: "embed"; ids: number[]; texts: string[] }
	| { type: "set-matrix"; matrix: Float32Array; count: number }
	| { type: "pairs"; threshold: number }
	| { type: "similar"; row: number; k: number };

export type EmbedResponse =
	| { type: "model-progress"; loaded: number; total: number }
	| { type: "ready" }
	| { type: "embedded"; ids: number[]; vectors: Float32Array }
	| { type: "pairs-progress"; done: number; total: number }
	| { type: "pairs-result"; pairs: Float32Array }
	| { type: "similar-result"; rows: Int32Array; sims: Float32Array }
	| { type: "error"; message: string };

const workerScope = self as unknown as {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<EmbedRequest>) => void) | null;
};

let extractor: FeatureExtractionPipeline | null = null;
/** Normalized vectors, row-major [count x DIM]. */
let matrix: Float32Array = new Float32Array(0);
let rowCount = 0;

async function ensureModel(): Promise<FeatureExtractionPipeline> {
	if (extractor) return extractor;
	extractor = await pipeline("feature-extraction", MODEL_ID, {
		dtype: "q8",
		progress_callback: (progress: { status: string; loaded?: number; total?: number }) => {
			if (progress.status === "progress" && progress.loaded && progress.total) {
				workerScope.postMessage({ type: "model-progress", loaded: progress.loaded, total: progress.total });
			}
		},
	});
	return extractor;
}

async function embedTexts(ids: number[], texts: string[]): Promise<void> {
	const model = await ensureModel();
	const output = await model(texts, { pooling: "mean", normalize: true });
	const data = output.data as Float32Array;
	const vectors = new Float32Array(ids.length * DIM);
	vectors.set(data.subarray(0, ids.length * DIM));
	workerScope.postMessage({ type: "embedded", ids, vectors }, [vectors.buffer]);
}

function computePairs(threshold: number): void {
	const results: number[] = [];
	for (let a = 0; a < rowCount; a++) {
		const aOffset = a * DIM;
		for (let b = a + 1; b < rowCount; b++) {
			const bOffset = b * DIM;
			let dot = 0;
			for (let d = 0; d < DIM; d++) dot += matrix[aOffset + d] * matrix[bOffset + d];
			if (dot >= threshold) results.push(a, b, dot);
		}
		if (a % PAIR_CHUNK_ROWS === 0) {
			workerScope.postMessage({ type: "pairs-progress", done: a, total: rowCount });
		}
	}
	const pairs = new Float32Array(results);
	workerScope.postMessage({ type: "pairs-result", pairs }, [pairs.buffer]);
}

function computeSimilar(row: number, k: number): void {
	const queryOffset = row * DIM;
	const scored: { row: number; sim: number }[] = [];
	for (let b = 0; b < rowCount; b++) {
		if (b === row) continue;
		let dot = 0;
		const bOffset = b * DIM;
		for (let d = 0; d < DIM; d++) dot += matrix[queryOffset + d] * matrix[bOffset + d];
		scored.push({ row: b, sim: dot });
	}
	scored.sort((x, y) => y.sim - x.sim);
	const top = scored.slice(0, k);
	workerScope.postMessage({
		type: "similar-result",
		rows: new Int32Array(top.map((t) => t.row)),
		sims: new Float32Array(top.map((t) => t.sim)),
	});
}

workerScope.onmessage = async (event) => {
	const message = event.data;
	try {
		switch (message.type) {
			case "init":
				await ensureModel();
				workerScope.postMessage({ type: "ready" });
				break;
			case "embed":
				await embedTexts(message.ids, message.texts);
				break;
			case "set-matrix":
				matrix = message.matrix;
				rowCount = message.count;
				break;
			case "pairs":
				computePairs(message.threshold);
				break;
			case "similar":
				computeSimilar(message.row, message.k);
				break;
		}
	} catch (error) {
		workerScope.postMessage({ type: "error", message: String(error) });
	}
};
