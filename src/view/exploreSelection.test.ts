// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { GraphInsightView } from "./GraphView";
import { ExploreNoteModal } from "../ui/ExploreNoteModal";
import { buildGraphModel, type GraphModel } from "../data/GraphStore";
import { NavigationTrail } from "../explore/navigationTrail";
import { installObsidianDom } from "../test/obsidianDom";
import { initI18n } from "../i18n";

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof import("obsidian")>(),
	ItemView: class {
		app: unknown;
		contentEl = document.body.createDiv();
		constructor(leaf: { app: unknown }) { this.app = leaf.app; }
	},
	debounce: (callback: () => void) => callback,
}));
vi.mock("../render/GraphRenderer", () => ({ GraphRenderer: class {} }));

interface Internals {
	model: GraphModel;
	renderer: { setSelected: (id: number) => void; destroy: () => void };
	hiddenMask: Uint8Array | null;
	exploreFocus: { centerId: number; neighbors: number[] } | null;
	exploreSession: { currentId: number; travelTo: (id: number) => void; stop: () => void } | null;
	exploreDetached: boolean;
	exploreTrail: NavigationTrail | null;
	exploreNoteModal: ExploreNoteModal | null;
	focusBar: HTMLElement;
	recomputeVisual: () => void;
	savePositions: () => Promise<void>;
	onClose: () => Promise<void>;
	enterExplore: (id: number) => Promise<void>;
	exitExplore: () => Promise<void>;
	navigateExploreTo: (id: number) => void;
	handleNodeClick: (id: number, event: PointerEvent) => void;
	openExploreNotePicker: () => void;
	renderExploreBar: () => void;
	detachExplore: () => void;
	exploreBack: () => void;
	handleKeyDown: (event: KeyboardEvent) => void;
}

beforeAll(() => { installObsidianDom(); initI18n("en"); });
function makeView() {
	const leaf = { app: {} } as unknown as WorkspaceLeaf;
	const view = new GraphInsightView(leaf, { settings: { openInSidePane: false } } as ConstructorParameters<typeof GraphInsightView>[1]) as unknown as Internals;
	view.model = buildGraphModel(["a.md", "folder/b.md", "c.md"], {}, {});
	view.renderer = { setSelected: vi.fn(), destroy: vi.fn() };
	const session = { currentId: 0, travelTo: vi.fn(), stop: vi.fn() };
	view.exploreSession = session;
	view.exploreFocus = { centerId: 0, neighbors: [] };
	view.exploreTrail = new NavigationTrail("explore");
	view.exploreTrail.push({ path: "a.md", label: "a" });
	view.focusBar = document.body.createDiv();
	view.recomputeVisual = vi.fn();
	return { view, session };
}

describe("Explore explicit destination", () => {
	test("node click travels regardless of the ordinary cursor tool", () => {
		const { view, session } = makeView();
		view.handleNodeClick(1, {} as PointerEvent);
		expect(session.travelTo).toHaveBeenCalledWith(1);
		expect(view.renderer.setSelected).toHaveBeenCalledWith(1);
	});

	test("current, hidden and missing nodes do not start a flight", () => {
		const { view, session } = makeView();
		view.hiddenMask = new Uint8Array([0, 1, 0]);
		for (const id of [0, 1, 99]) view.navigateExploreTo(id);
		expect(session.travelTo).not.toHaveBeenCalled();
	});

	test("picker filters hidden notes and resolves current ids from paths", () => {
		const { view, session } = makeView();
		view.hiddenMask = new Uint8Array([0, 0, 1]);
		view.openExploreNotePicker();
		const picker = view.exploreNoteModal!;
		expect(picker.getItems().map((node) => node.path)).toEqual(["a.md", "folder/b.md"]);
		const chosen = picker.getItems()[1];
		view.model = buildGraphModel(["folder/b.md", "a.md", "c.md"], {}, {});
		session.currentId = 1;
		picker.onChooseItem(chosen);
		expect(session.travelTo).toHaveBeenCalledWith(0);
		picker.close();
		expect(view.exploreNoteModal).toBeNull();
	});

	test("new filters, deleted paths and a previous trip cannot accept old picks", () => {
		const { view, session } = makeView();
		view.openExploreNotePicker();
		const picker = view.exploreNoteModal!;
		const chosen = picker.getItems()[1];
		view.hiddenMask = new Uint8Array([0, 1, 0]);
		picker.onChooseItem(chosen);
		view.hiddenMask = null;
		view.model = buildGraphModel(["a.md"], {}, {});
		picker.onChooseItem(chosen);
		view.model = buildGraphModel(["a.md", "folder/b.md"], {}, {});
		view.exploreTrail = new NavigationTrail("explore");
		picker.onChooseItem(chosen);
		expect(session.travelTo).not.toHaveBeenCalled();
		picker.close();
	});

	test("detaching keeps the picker available and Back reanchors the same trail", () => {
		const { view, session } = makeView();
		const trail = view.exploreTrail!;
		trail.push({ path: "folder/b.md", label: "b" });
		view.enterExplore = vi.fn(async () => {});
		view.detachExplore();
		expect(session.stop).toHaveBeenCalledOnce();
		expect(view.focusBar.hidden).toBe(false);
		expect(view.focusBar.textContent).toContain("Choose note");
		view.exploreBack();
		expect(view.enterExplore).toHaveBeenCalledWith(0);
		expect(view.exploreTrail).toBe(trail);
		expect(trail.activeCrumb?.path).toBe("a.md");
	});

	test("Back skips filtered crumbs and retains its index when none are reachable", () => {
		const { view, session } = makeView();
		const trail = view.exploreTrail!;
		trail.push({ path: "folder/b.md", label: "b" });
		trail.push({ path: "c.md", label: "c" });
		session.currentId = 2;
		view.hiddenMask = new Uint8Array([1, 1, 0]);
		view.exploreBack();
		expect(trail.activeIndex).toBe(2);
		expect(session.travelTo).not.toHaveBeenCalled();
		view.hiddenMask[0] = 0;
		view.exploreBack();
		expect(trail.activeIndex).toBe(0);
		expect(session.travelTo).toHaveBeenCalledWith(0);
	});

	test("a filtered breadcrumb cannot change the trail cursor", () => {
		const { view, session } = makeView();
		const trail = view.exploreTrail!;
		trail.push({ path: "folder/b.md", label: "b" });
		session.currentId = 1;
		view.hiddenMask = new Uint8Array([1, 0, 0]);
		view.renderExploreBar();
		view.focusBar.querySelector<HTMLButtonElement>(".graph-insight-breadcrumb-crumb")!.click();
		expect(trail.activeIndex).toBe(1);
		expect(session.travelTo).not.toHaveBeenCalled();
		expect(Array.from(view.focusBar.querySelectorAll("button")).find((button) => button.textContent === "Back")?.disabled).toBe(true);
	});

	test("keyboard events inside an open picker leave Explore running", () => {
		const { view } = makeView();
		view.openExploreNotePicker();
		view.exitExplore = vi.fn(async () => {});
		view.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(view.exitExplore).not.toHaveBeenCalled();
		view.exploreNoteModal!.close();
	});

	test("closing the graph dismisses the picker and blocks stale selection", async () => {
		const { view, session } = makeView();
		view.savePositions = vi.fn(async () => {});
		view.openExploreNotePicker();
		const picker = view.exploreNoteModal!;
		const chosen = picker.getItems()[1];
		view.openExploreNotePicker();
		expect(view.exploreNoteModal).toBe(picker);
		await view.onClose();
		expect(view.exploreNoteModal).toBeNull();
		expect(session.stop).toHaveBeenCalledOnce();
		picker.onChooseItem(chosen);
		expect(session.travelTo).not.toHaveBeenCalled();
	});

	test("exit closes the picker and invalidates further choices", async () => {
		const { view, session } = makeView();
		view.openExploreNotePicker();
		const picker = view.exploreNoteModal!;
		const chosen = picker.getItems()[1];
		await view.exitExplore();
		expect(view.exploreNoteModal).toBeNull();
		picker.onChooseItem(chosen);
		expect(session.travelTo).not.toHaveBeenCalled();
	});
});
