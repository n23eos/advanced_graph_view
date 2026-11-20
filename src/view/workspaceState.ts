import { validateQuery } from "../query/QueryParser";
import type { PanelState } from "../ui/ControlPanel";
import { createGraphAppearance, type GraphAppearance } from "../settings/appearance";
import { normalizeGraphAppearance } from "../settings/normalize";

const MIN_VIEWPORT_SCALE = 0.02;
const MAX_VIEWPORT_SCALE = 8;
const MAX_CAMERA_PITCH = 1.45;

export interface ViewportState {
	centerX: number;
	centerY: number;
	scale: number;
	referenceScale: number;
}

export interface Camera3DState {
	position: { x: number; y: number; z: number };
	pivot: { x: number; y: number; z: number };
	yaw: number;
	pitch: number;
}

export interface CameraState {
	viewport: ViewportState;
	camera3d: Camera3DState;
}

export interface GraphViewState extends Record<string, unknown> {
	version: 1;
	camera?: CameraState;
	hardQuery?: string;
	appearance?: GraphAppearance;
}

export function createNewGraphViewState(panel: PanelState): GraphViewState {
	return {
		version: 1,
		appearance: createGraphAppearance(panel, "modern"),
	};
}

export function normalizeGraphViewState(value: unknown, fallbackPanel?: PanelState): GraphViewState | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const state: GraphViewState = { version: 1 };
	const camera = normalizeCamera(value.camera);
	if (camera) state.camera = camera;
	if (typeof value.hardQuery === "string" && validateQuery(value.hardQuery) === null) {
		state.hardQuery = value.hardQuery;
	}
	if (fallbackPanel) {
		const appearance = normalizeGraphAppearance(value.appearance, fallbackPanel);
		if (appearance) state.appearance = appearance;
	}
	return state;
}

export interface LocalGraphViewState {
	version: 1;
	appearance: GraphAppearance;
}

export function normalizeLocalGraphViewState(
	value: unknown,
	fallbackPanel: PanelState
): LocalGraphViewState | null {
	if (!isRecord(value)) return null;
	if (value.version !== undefined && value.version !== 1) return null;
	return {
		version: 1,
		appearance: normalizeGraphAppearance(value.appearance, fallbackPanel, "legacy")!,
	};
}

function normalizeCamera(value: unknown): CameraState | null {
	if (!isRecord(value)) return null;
	const viewport = normalizeViewport(value.viewport);
	const camera3d = normalizeCamera3d(value.camera3d);
	return viewport && camera3d ? { viewport, camera3d } : null;
}

function normalizeViewport(value: unknown): ViewportState | null {
	if (!isRecord(value)) return null;
	const { centerX, centerY, scale, referenceScale } = value;
	if (
		!isFiniteNumber(centerX) ||
		!isFiniteNumber(centerY) ||
		!isViewportScale(scale) ||
		!isViewportScale(referenceScale)
	) return null;
	return { centerX, centerY, scale, referenceScale };
}

function normalizeCamera3d(value: unknown): Camera3DState | null {
	if (!isRecord(value) || !isFiniteNumber(value.yaw) || !isFiniteNumber(value.pitch)) return null;
	if (value.pitch < -MAX_CAMERA_PITCH || value.pitch > MAX_CAMERA_PITCH) return null;
	const position = normalizePoint(value.position);
	const pivot = normalizePoint(value.pivot);
	return position && pivot ? { position, pivot, yaw: value.yaw, pitch: value.pitch } : null;
}

function normalizePoint(value: unknown): { x: number; y: number; z: number } | null {
	if (!isRecord(value)) return null;
	const { x, y, z } = value;
	return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? { x, y, z } : null;
}

function isViewportScale(value: unknown): value is number {
	return isFiniteNumber(value) && value >= MIN_VIEWPORT_SCALE && value <= MAX_VIEWPORT_SCALE;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
