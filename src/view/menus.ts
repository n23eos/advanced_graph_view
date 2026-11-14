import { nodeDisplayPath, nodeMarkdown } from "../data/graphNodes";
import { Menu, Notice } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import { t, type TranslationKey } from "../i18n";

export interface MenuTaskAction<TaskId extends string> {
	id: TaskId;
	labelKey: TranslationKey;
}

export interface GraphMenusDeps<TaskId extends string> {
	getModel(): GraphModel | null;
	getHiddenNodes(): Set<number>;
	setHiddenNodeCount(count: number): void;
	recomputeVisual(): void;
	openNode(nodeId: number, newTab: boolean): void;
	openNodeInSplit(nodeId: number): void;
	canRevealNode(): boolean;
	revealNode(nodeId: number): void;
	enterFocus(nodeId: number): void;
	enterExplore(nodeId: number): void;
	isPinned(nodeId: number): boolean;
	togglePin(nodeId: number): void;
	setSelectionPinned(nodeIds: readonly number[], pinned: boolean): void;
	exportLasso(nodeIds: number[]): void;
	writeClipboard(text: string): Promise<void>;
	getTaskActions(): readonly MenuTaskAction<TaskId>[];
	runTask(taskId: TaskId): void;
	getFollowActiveNote(): boolean;
	setFollowActiveNote(enabled: boolean): void;
	getOpenInSidePane(): boolean;
	setOpenInSidePane(enabled: boolean): void;
	activateLocalGraph(): void;
	fitAll(): void;
	resetCamera(): void;
	getIsExploring(): boolean;
	toggleExplore(): void;
	openPresetManager(): void;
	toggleChangesPanel(): void;
}

export class GraphMenus<TaskId extends string> {
	constructor(private readonly deps: GraphMenusDeps<TaskId>) {}

	private get model() { return this.deps.getModel(); }
	private get hiddenNodes() { return this.deps.getHiddenNodes(); }

	showNodeMenu(nodeId: number, event: MouseEvent): void {
		if (!this.model) return;
		const node = this.model.nodes[nodeId];
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t(node.kind === "unresolved" ? "nodes.openSource" : "menu.open")).setIcon("file-text").onClick(() => this.deps.openNode(nodeId, false)));
		menu.addItem((item) => item.setTitle(t("menu.openNewTab")).setIcon("file-plus").onClick(() => this.deps.openNode(nodeId, true)));
		menu.addItem((item) => item.setTitle(t("menu.openRight")).setIcon("separator-vertical").onClick(() => this.deps.openNodeInSplit(nodeId)));
		if (node.kind !== "unresolved" && this.deps.canRevealNode()) {
			menu.addItem((item) => item.setTitle(t("menu.reveal")).setIcon("folder-open").onClick(() => this.deps.revealNode(nodeId)));
		}
		menu.addItem((item) => item.setTitle(t("menu.focus")).setIcon("target").onClick(() => this.deps.enterFocus(nodeId)));
		menu.addItem((item) => item.setTitle(t("menu.explore")).setIcon("compass").onClick(() => this.deps.enterExplore(nodeId)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("menu.hide")).setIcon("eye-off").onClick(() => {
			this.hiddenNodes.add(nodeId);
			this.deps.setHiddenNodeCount(this.hiddenNodes.size);
			this.deps.recomputeVisual();
		}));
		const pinned = this.deps.isPinned(nodeId);
		menu.addItem((item) => item.setTitle(pinned ? t("menu.unpin") : t("menu.pin")).setIcon("pin").onClick(() => {
			this.deps.togglePin(nodeId);
		}));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("menu.copyLink")).setIcon("link").onClick(async () => {
			// Write-only: paste-ready Obsidian wikilink for the note.
			await this.deps.writeClipboard(nodeMarkdown(node));
			new Notice(t("notice.copiedLink", { name: node.name }));
		}));
		menu.addItem((item) => item.setTitle(t("menu.path", { path: nodeDisplayPath(node) })).setDisabled(true));
		menu.showAtMouseEvent(event);
	}

	showLassoMenu(nodeIds: number[], event: PointerEvent): void {
		if (!this.model) return;
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(t("menu.selected", { count: nodeIds.length })).setDisabled(true));
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("topicmap.export"))
				.setIcon("map")
				.onClick(() => this.deps.exportLasso(nodeIds))
		);
		menu.addItem((item) => item.setTitle(t("menu.hideSelected")).setIcon("eye-off").onClick(() => {
			for (const id of nodeIds) this.hiddenNodes.add(id);
			this.deps.setHiddenNodeCount(this.hiddenNodes.size);
			this.deps.recomputeVisual();
		}));
		const allPinned = nodeIds.every((id) => this.deps.isPinned(id));
		menu.addItem((item) => item
			.setTitle(allPinned ? t("menu.unpinSelected") : t("menu.pinSelected"))
			.setIcon("pin")
			.onClick(() => this.deps.setSelectionPinned(nodeIds, !allPinned)));
		menu.addItem((item) => item.setTitle(t("menu.copyPaths")).setIcon("copy").onClick(async () => {
			// Write-only, and only from this explicit menu action - the plugin never reads the clipboard.
			const paths = nodeIds.map((id) => nodeDisplayPath(this.model!.nodes[id])).join("\n");
			await this.deps.writeClipboard(paths);
			new Notice(t("notice.copiedPaths", { count: nodeIds.length }));
		}));
		menu.showAtMouseEvent(event);
	}

	showTasksMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		for (const action of this.deps.getTaskActions()) {
			menu.addItem((item) => item.setTitle(t(action.labelKey)).onClick(() => this.deps.runTask(action.id)));
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	showOverflowMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t("tool.follow"))
				.setIcon("locate-fixed")
				.setChecked(this.deps.getFollowActiveNote())
				.onClick(() => this.deps.setFollowActiveNote(!this.deps.getFollowActiveNote()))
		);
		menu.addItem((item) =>
			item
				.setTitle(t("tool.sidePane"))
				.setIcon("panel-right")
				.setChecked(this.deps.getOpenInSidePane())
				.onClick(() => this.deps.setOpenInSidePane(!this.deps.getOpenInSidePane()))
		);
		menu.addItem((item) =>
			item
				.setTitle(t("tool.localGraph"))
				.setIcon("orbit")
				.onClick(() => this.deps.activateLocalGraph())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(t("camera.fit")).setIcon("maximize").onClick(() => this.deps.fitAll())
		);
		menu.addItem((item) =>
			item.setTitle(t("camera.reset")).setIcon("rotate-ccw").onClick(() => this.deps.resetCamera())
		);
		menu.addItem((item) =>
			item
				.setTitle(t("camera.explore"))
				.setIcon("compass")
				.setChecked(this.deps.getIsExploring())
				.onClick(() => this.deps.toggleExplore())
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(t("preset.manage")).setIcon("list").onClick(() => this.deps.openPresetManager())
		);
		menu.addItem((item) =>
			item.setTitle(t("changes.open")).setIcon("history").onClick(() => this.deps.toggleChangesPanel())
		);
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}
}
