// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { PanelState } from "../ui/ControlPanel";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { GraphInsightView } from "./GraphView";

vi.mock("obsidian", async (original) => ({ ...await original<typeof import("obsidian")>(), ItemView: class {} }));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

const panelHost = vi.hoisted(() => ({ onChange: null as null | ((state: PanelState) => void) }));
vi.mock("../ui/ControlPanel", async (original) => ({
	...await original<typeof import("../ui/ControlPanel")>(),
	ControlPanel: class {
		constructor(_host: unknown, _state: unknown, callbacks: { onChange: (state: PanelState) => void }) {
			panelHost.onChange = callbacks.onChange;
		}
	},
}));

function harness() {
	const view = Object.create(GraphInsightView.prototype) as {
		applyAllPanelState(state: PanelState, prev?: PanelState): void;
		buildPanel(state: PanelState): void;
	};
	const effects = {
		applyEncoding: vi.fn(), applyOverlays: vi.fn(), redrawBubbles: vi.fn(), syncTimelineAndTrail: vi.fn(),
		applyPhysics: vi.fn(), applyLayoutRule: vi.fn(), apply3D: vi.fn(),
	};
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		savePanelState: vi.fn((panel: PanelState) => { plugin.settings.panel = panel; return Promise.resolve(); }),
	};
	Object.assign(view, effects, { plugin, facts: [], renderer: { setLabelOptions: vi.fn(), setEdgeStyle: vi.fn() } });
	return { view, effects, plugin };
}

describe("selective panel application", () => {
	test("a physics slider does not repeat expensive effects but still applies physics", () => {
		const { view, effects, plugin } = harness();
		const prev = plugin.settings.panel;
		const next = { ...prev, physics: { ...prev.physics, repel: prev.physics.repel + 1 } };
		view.applyAllPanelState(next, prev);
		for (const effect of [effects.applyEncoding, effects.applyOverlays, effects.redrawBubbles, effects.syncTimelineAndTrail]) {
			expect(effect).not.toHaveBeenCalled();
		}
		expect(effects.applyPhysics).toHaveBeenCalledWith(next);
	});
	test("a full application still runs every expensive effect", () => {
		const { view, effects, plugin } = harness();
		view.applyAllPanelState(plugin.settings.panel);
		for (const effect of [effects.applyEncoding, effects.applyOverlays, effects.redrawBubbles, effects.syncTimelineAndTrail]) {
			expect(effect).toHaveBeenCalledOnce();
		}
	});
	test("panel callbacks compare against the state before synchronous persistence updates it", () => {
		const { view, effects, plugin } = harness();
		view.buildPanel(plugin.settings.panel);
		const next = { ...plugin.settings.panel, nodeScale: plugin.settings.panel.nodeScale + 1 };
		panelHost.onChange!(next);
		expect(plugin.settings.panel).toBe(next);
		expect(effects.applyEncoding).toHaveBeenCalledWith(next);
		expect(effects.redrawBubbles).toHaveBeenCalledOnce();
		expect(effects.applyOverlays).not.toHaveBeenCalled();
		expect(effects.syncTimelineAndTrail).not.toHaveBeenCalled();
	});
});
