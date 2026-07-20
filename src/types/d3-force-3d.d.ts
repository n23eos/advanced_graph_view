/** Minimal typings for d3-force-3d — same shapes as d3-force plus z axis. */
declare module "d3-force-3d" {
	export interface SimulationNodeDatum3D {
		index?: number;
		x?: number;
		y?: number;
		z?: number;
		vx?: number;
		vy?: number;
		vz?: number;
		fx?: number | null;
		fy?: number | null;
		fz?: number | null;
	}

	export interface Simulation3D<N extends SimulationNodeDatum3D> {
		tick(iterations?: number): this;
		alpha(): number;
		alpha(alpha: number): this;
		alphaMin(): number;
		alphaMin(min: number): this;
		alphaTarget(): number;
		alphaTarget(target: number): this;
		velocityDecay(): number;
		velocityDecay(decay: number): this;
		force(name: string): unknown;
		force(name: string, force: unknown): this;
		stop(): this;
		nodes(): N[];
	}

	export function forceSimulation<N extends SimulationNodeDatum3D>(
		nodes?: N[],
		numDimensions?: 2 | 3
	): Simulation3D<N>;

	export function forceLink(links?: unknown[]): {
		id(accessor: (d: unknown) => unknown): ReturnType<typeof forceLink>;
		distance(d: number): ReturnType<typeof forceLink>;
		strength(s: number): ReturnType<typeof forceLink>;
	};

	export function forceManyBody(): {
		theta(t: number): ReturnType<typeof forceManyBody>;
		strength(s: number): ReturnType<typeof forceManyBody>;
		distanceMax(d: number): ReturnType<typeof forceManyBody>;
	};

	export function forceX(x?: number): { strength(s: number): ReturnType<typeof forceX> };
	export function forceY(y?: number): { strength(s: number): ReturnType<typeof forceY> };
	export function forceZ(z?: number): { strength(s: number): ReturnType<typeof forceZ> };
}
