import type { GraphRenderer } from "../render/GraphRenderer";
import type { Adjacency } from "../analysis/focus";
import { prefersReducedMotion } from "../render/motion";
import { t } from "../i18n";

const HOLD_MS = 8_000;
const FLIGHT_MS = 2_600;
const REVEAL_MS = 1_300;
const DEPART_MS = 650;
const NEIGHBOR_LIMIT = 12;
type Point = NonNullable<ReturnType<GraphRenderer["nodePosition"]>>;
type Graph = { links: Adjacency; names: readonly string[] };

function ease(progress: number): number {
	return progress * progress * (3 - 2 * progress);
}

export class GraphScreensaver {
	readonly camera: NonNullable<ReturnType<GraphRenderer["getCameraState"]>>;
	private readonly was3D: boolean;
	private frame = 0;
	private active = false;
	private stopped = false;
	private paused = false;
	private elapsed = 0;
	private lastFrame: number | null = null;
	private yaw = 0;
	private center: number | null = null;
	private recent: number[] = [];
	private from: Point | null = null;
	private pivot: Point | null = null;
	private arrived = false;
	private radius = 0;
	private fromRadius = 0;
	private pitch = 0;
	private panel: HTMLElement | null = null;
	private title: HTMLElement | null = null;
	private previousFocus: HTMLElement | null = null;

	constructor(
		private readonly host: HTMLElement,
		private readonly renderer: GraphRenderer,
		camera: GraphScreensaver["camera"],
		private readonly getGraph: () => Graph | null,
		private readonly onStop: () => void,
	) {
		this.camera = camera;
		this.was3D = renderer.camera.enabled;
	}

	async start(): Promise<void> {
		const doc = this.host.ownerDocument;
		this.previousFocus = this.host.querySelector<HTMLButtonElement>(".graph-insight-screensaver-button");
		doc.addEventListener("fullscreenchange", this.onFullscreenChange);
		try {
			await this.host.requestFullscreen();
		} catch {
			this.stop();
			return;
		}
		if (this.stopped || doc.fullscreenElement !== this.host) {
			if (doc.fullscreenElement === this.host) void doc.exitFullscreen().catch(() => {});
			this.stop();
			return;
		}
		this.active = true;
		this.host.classList.add("graph-insight-screensaver");
		this.renderer.set3DMode(true);
		this.renderer.resize();
		const camera = this.renderer.camera;
		this.yaw = camera.yaw;
		this.pitch = camera.pitch;
		this.pivot = { x: camera.tx, y: camera.ty, z: camera.tz };
		this.radius = Math.hypot(camera.px - camera.tx, camera.py - camera.ty, camera.pz - camera.tz);
		this.renderer.setPresentationLinks(0);
		const controls = this.host.createDiv({ cls: "graph-insight-screensaver-controls" });
		this.panel = controls;
		this.title = controls.createDiv({ cls: "graph-insight-screensaver-title" });
		const pause = controls.createEl("button", { text: t("screensaver.pause") });
		pause.addEventListener("click", () => {
			this.paused = !this.paused;
			if (this.paused) this.renderer.playPresentationPulse(null);
			pause.textContent = t(this.paused ? "screensaver.resume" : "screensaver.pause");
		});
		const exit = controls.createEl("button", { text: t("explore.exit") });
		exit.addEventListener("click", () => this.stop());
		exit.focus({ preventScroll: true });
		doc.addEventListener("keydown", this.onKey, true);
		this.frame = this.renderer.ownerWindow.requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		const doc = this.host.ownerDocument;
		doc.removeEventListener("fullscreenchange", this.onFullscreenChange);
		doc.removeEventListener("keydown", this.onKey, true);
		if (this.active) {
			this.renderer.ownerWindow.cancelAnimationFrame(this.frame);
			this.panel?.remove();
			this.host.classList.remove("graph-insight-screensaver");
			this.renderer.playPresentationPulse(null);
			this.renderer.setPresentationLinks(null);
			this.renderer.setExploreOverlay(null);
			this.renderer.set3DMode(this.was3D);
			this.renderer.restoreCameraState(this.camera);
		}
		if (doc.fullscreenElement === this.host) void doc.exitFullscreen().catch(() => {});
		this.previousFocus?.focus({ preventScroll: true });
		this.onStop();
	}

	private readonly onFullscreenChange = () => {
		if (this.active && this.host.ownerDocument.fullscreenElement !== this.host) this.stop();
	};

	private readonly onKey = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopImmediatePropagation();
		this.stop();
	};

	private chooseNode(graph: Graph): void {
		const available = (id: number) => this.renderer.isPresentationNodeVisible(id);
		const neighbors = this.center === null ? [] : (graph.links[this.center] ?? []).filter(available);
		const nearest = this.center === null ? this.renderer.nodeNearestToViewCenter() : null;
		const next = nearest ?? neighbors.find(id => !this.recent.includes(id))
			?? graph.names.findIndex((_, id) => available(id) && !this.recent.includes(id));
		if (next < 0 && this.center !== null && available(this.center)) {
			this.recent = [this.center];
			this.elapsed = FLIGHT_MS + REVEAL_MS;
			return;
		}
		const id = next >= 0 ? next : this.renderer.nodeNearestToViewCenter();
		if (id === null || !available(id)) {
			this.center = null;
			this.renderer.setExploreOverlay(null);
			if (this.title) this.title.textContent = "";
			return;
		}
		this.from = this.pivot;
		this.fromRadius = this.radius;
		this.arrived = false;
		this.center = id;
		this.recent = [id, ...this.recent].slice(0, 8);
	}

	private revealNode(graph: Graph, id: number, reduced: boolean): void {
		const links = [...new Set(graph.links[id] ?? [])].filter(other =>
			other !== id && this.renderer.isPresentationNodeVisible(other)
		).slice(0, NEIGHBOR_LIMIT);
		this.renderer.setExploreOverlay({ centerId: id, candidateId: null, neighbors: links });
		if (!reduced) this.renderer.playPresentationPulse(id, links);
		if (this.title) this.title.textContent = graph.names[id] ?? "";
	}

	private readonly tick = (now: number) => {
		const graph = this.getGraph();
		if (!graph) {
			this.stop();
			return;
		}
		const win = this.renderer.ownerWindow;
		this.frame = win.requestAnimationFrame(this.tick);
		const delta = this.lastFrame === null ? 0 : Math.min(64, now - this.lastFrame);
		this.lastFrame = now;
		if (this.paused || this.host.ownerDocument.hidden) return;
		const reduced = prefersReducedMotion(win);
		this.elapsed += delta;
		if (this.center === null || !this.renderer.isPresentationNodeVisible(this.center) || this.elapsed >= HOLD_MS) {
			this.elapsed = 0;
			this.chooseNode(graph);
		}
		const id = this.center;
		if (id === null) return;
		const target = this.renderer.nodePosition(id);
		if (!target) return;
		const blend = reduced ? 1 : Math.min(1, this.elapsed / FLIGHT_MS);
		const arriving = blend === 1;
		const from = this.from ?? target;
		const eased = ease(blend);
		const orbitRadius = Math.max(240, this.renderer.camera.focal * 0.65);
		const distance = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
		const pullback = Math.min(distance * 0.16, orbitRadius * 0.85);
		const still = reduced && this.arrived && this.pivot?.x === target.x
			&& this.pivot.y === target.y && this.pivot.z === target.z;
		this.pivot = {
			x: from.x + (target.x - from.x) * eased,
			y: from.y + (target.y - from.y) * eased,
			z: from.z + (target.z - from.z) * eased,
		};
		this.radius = this.fromRadius + (orbitRadius - this.fromRadius) * eased
			+ Math.sin(Math.PI * blend) ** 2 * pullback;
		this.yaw += reduced ? 0 : delta * (0.00011 + (1 - Math.sin(Math.PI * blend)) * 0.00004);
		if (!still) this.renderer.orbitPresentation(this.pivot, this.radius, this.yaw, this.pitch);
		if (arriving && !this.arrived) {
			this.arrived = true;
			this.revealNode(graph, id, reduced);
		}
		const emphasis = reduced ? 1 : arriving
			? ease(Math.min(1, (this.elapsed - FLIGHT_MS) / REVEAL_MS))
			: 1 - ease(Math.min(1, this.elapsed / DEPART_MS));
		this.renderer.setPresentationLinks(emphasis);
		if (this.title) this.title.style.opacity = String(emphasis);
	};
}
