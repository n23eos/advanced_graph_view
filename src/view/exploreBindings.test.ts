// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { PanelState } from "../ui/ControlPanel";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { ExploreBindings, type ExploreBindingsDeps } from "./exploreBindings";
import { GraphInsightView } from "./GraphView";

vi.mock("obsidian", async (original) => ({
	...await original<typeof import("obsidian")>(),
	ItemView: class {},
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

function panel(overrides: Partial<PanelState> = {}): PanelState {
	return { ...structuredClone(DEFAULT_SETTINGS.panel), ...overrides };
}

describe("Explore panel state", () => {
	test("forces and restores the effective state of the current leaf", async () => {
		const global = panel({ nodeScale: 1 });
		let effective = panel({
			nodeScale: 2,
			view3d: { ...global.view3d, enabled: false },
		});
		let override = true;
		const applyAllPanelState = vi.fn<(state: PanelState, prev?: PanelState) => void>();
		const bindings = new ExploreBindings({
			getPanelState: () => effective,
			getPlugin: () => ({ settings: { panel: global, openInSidePane: false } }),
			getExploreSession: () => null,
			setExploreSession: vi.fn(),
			getExploreDetached: () => true,
			setExploreDetached: vi.fn(),
			getExploreTrail: () => null,
			setExploreTrail: vi.fn(),
			getExploreOverride: () => override,
			setExploreOverride: (value: boolean) => { override = value; },
			getExploreFocus: () => null,
			setExploreFocus: vi.fn(),
			getExploreNoteModal: () => null,
			setExploreNoteModal: vi.fn(),
			getFocusBar: () => null,
			getCameraWidget: () => null,
			showExploreTarget: vi.fn(),
			applyAllPanelState,
			recomputeVisual: vi.fn(),
			getRebuildDeferred: () => false,
		} as unknown as ExploreBindingsDeps);

		bindings.applyExploreOverride();
		const forced = applyAllPanelState.mock.calls.at(-1)?.[0];
		expect(forced?.nodeScale).toBe(2);
		expect(forced?.view3d.enabled).toBe(true);
		expect(forced?.physics.disabled).toBe(true);

		effective = panel({
			nodeScale: 3,
			view3d: { ...global.view3d, enabled: false },
		});
		await bindings.exitExplore();
		expect(applyAllPanelState).toHaveBeenLastCalledWith(effective);
	});

	test("shared control changes keep the runtime Explore dimensions forced", () => {
		const view = Object.create(GraphInsightView.prototype) as {
			exploreOverride: boolean;
			applyAllPanelState(state: PanelState, prev?: PanelState): void;
		};
		const effects = {
			applyEncoding: vi.fn<(state: PanelState) => void>(),
			applyOverlays: vi.fn(),
			redrawBubbles: vi.fn(),
			syncTimelineAndTrail: vi.fn(),
			applyPhysics: vi.fn<(state: PanelState) => void>(),
			applyLayoutRule: vi.fn(),
			apply3D: vi.fn<(state: PanelState, allowRestart: boolean) => void>(),
		};
		Object.assign(view, effects, {
			exploreOverride: true,
			renderer: { setLabelOptions: vi.fn(), setEdgeStyle: vi.fn() },
		});
		const prev = panel({
			nodeScale: 1,
			view3d: { ...DEFAULT_SETTINGS.panel.view3d, enabled: false },
		});
		const next = { ...prev, nodeScale: 2 };

		view.applyAllPanelState(next, prev);

		const encoded = effects.applyEncoding.mock.calls[0]?.[0];
		const physics = effects.applyPhysics.mock.calls[0]?.[0];
		const dimensions = effects.apply3D.mock.calls[0];
		expect(encoded?.nodeScale).toBe(2);
		expect(encoded?.view3d.enabled).toBe(true);
		expect(physics?.physics.disabled).toBe(true);
		expect(dimensions?.[0].view3d.enabled).toBe(true);
		expect(dimensions?.[1]).toBe(true);
	});

	test("direct rebuild applications keep Explore in 3D with physics stopped", () => {
		const view = Object.create(GraphInsightView.prototype) as {
			exploreOverride: boolean;
			apply3D(state: PanelState, allowRestart: boolean): void;
			applyPhysics(state: PanelState): void;
		};
		const renderer = {
			set3DMode: vi.fn(),
			setCameraFocal: vi.fn(),
			setDepthOverride: vi.fn(),
			isDragging: false,
		};
		const layout = { setParams: vi.fn(), reheat: vi.fn() };
		Object.assign(view, {
			exploreOverride: true,
			renderer,
			layout,
			model: { nodes: [] },
			last3DKey: "",
			lastPhysics: "",
		});
		const saved = panel({
			view3d: { ...DEFAULT_SETTINGS.panel.view3d, enabled: false },
			physics: { ...DEFAULT_SETTINGS.panel.physics, disabled: false },
		});

		view.apply3D(saved, false);
		view.applyPhysics(saved);

		expect(renderer.set3DMode).toHaveBeenCalledWith(true);
		expect(layout.setParams).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
		expect(layout.reheat).not.toHaveBeenCalled();
	});
});
