/**
 * In-memory store: path → (content hash, embedding vector).
 * Persists as embeddings.bin (raw Float32 matrix) + embeddings-index.json
 * (paths, hashes, dim) — spec forbids vectors in JSON.
 */

export interface IndexMeta {
	dim: number;
	paths: string[];
	hashes: number[];
}

export class EmbeddingIndex {
	private paths: string[] = [];
	private hashes: number[] = [];
	private vectors: Float32Array[] = [];
	private pathToRow = new Map<string, number>();

	constructor(readonly dim: number) {}

	get size(): number {
		return this.paths.length;
	}

	set(path: string, hash: number, vector: Float32Array): void {
		const row = this.pathToRow.get(path);
		if (row !== undefined) {
			this.hashes[row] = hash;
			this.vectors[row] = vector;
			return;
		}
		this.pathToRow.set(path, this.paths.length);
		this.paths.push(path);
		this.hashes.push(hash);
		this.vectors.push(vector);
	}

	getVector(path: string): Float32Array | null {
		const row = this.pathToRow.get(path);
		return row === undefined ? null : this.vectors[row];
	}

	getHash(path: string): number | null {
		const row = this.pathToRow.get(path);
		return row === undefined ? null : this.hashes[row];
	}

	remove(path: string): void {
		const row = this.pathToRow.get(path);
		if (row === undefined) return;
		const last = this.paths.length - 1;
		if (row !== last) {
			// Swap-remove keeps arrays dense.
			this.paths[row] = this.paths[last];
			this.hashes[row] = this.hashes[last];
			this.vectors[row] = this.vectors[last];
			this.pathToRow.set(this.paths[row], row);
		}
		this.paths.pop();
		this.hashes.pop();
		this.vectors.pop();
		this.pathToRow.delete(path);
	}

	rename(oldPath: string, newPath: string): void {
		const row = this.pathToRow.get(oldPath);
		if (row === undefined) return;
		this.pathToRow.delete(oldPath);
		this.paths[row] = newPath;
		this.pathToRow.set(newPath, row);
	}

	serialize(): { meta: IndexMeta; vectors: ArrayBuffer } {
		const matrix = new Float32Array(this.paths.length * this.dim);
		for (let row = 0; row < this.vectors.length; row++) {
			matrix.set(this.vectors[row], row * this.dim);
		}
		return {
			meta: { dim: this.dim, paths: [...this.paths], hashes: [...this.hashes] },
			vectors: matrix.buffer,
		};
	}

	static deserialize(meta: IndexMeta, vectors: ArrayBuffer): EmbeddingIndex {
		const index = new EmbeddingIndex(meta.dim);
		const matrix = new Float32Array(vectors);
		for (let row = 0; row < meta.paths.length; row++) {
			index.set(
				meta.paths[row],
				meta.hashes[row],
				matrix.slice(row * meta.dim, (row + 1) * meta.dim)
			);
		}
		return index;
	}

	/** Contiguous matrix + path order — the worker input for pair search. */
	packAll(): { paths: string[]; matrix: Float32Array } {
		const matrix = new Float32Array(this.paths.length * this.dim);
		for (let row = 0; row < this.vectors.length; row++) {
			matrix.set(this.vectors[row], row * this.dim);
		}
		return { paths: [...this.paths], matrix };
	}
}
