import { TFile, type App, type TAbstractFile, type View, type WorkspaceLeaf } from "obsidian";
import type { GraphModel } from "../data/GraphStore";
import { chooseCompanionAction } from "./companionPane";

export interface NoteNavigationDeps {
	getApp(): App;
	getLeaf(): WorkspaceLeaf;
	getModel(): GraphModel | null;
	getOpenInSidePane(): boolean;
	setSelfOpenedPath(path: string): void;
	getCompanionLeafId(): string | null;
	setCompanionLeafId(id: string): void;
}

export interface FileExplorerView extends View {
	revealInFolder(file: TAbstractFile): void;
}

export class NoteNavigation {
	constructor(private readonly deps: NoteNavigationDeps) {}

	private get app() { return this.deps.getApp(); }
	private get leaf() { return this.deps.getLeaf(); }
	private get model() { return this.deps.getModel(); }

	openNode(nodeId: number, newTab: boolean): void {
		const file = this.nodeFile(nodeId);
		if (!file) return;
		// An explicit new tab still means a new tab; side-pane mode only changes a plain click.
		if (!newTab && this.deps.getOpenInSidePane()) {
			this.openNodeInSplit(nodeId);
			return;
		}
		this.deps.setSelfOpenedPath(file.path);
		void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
	}

	openNodeInSplit(nodeId: number): void {
		const file = this.nodeFile(nodeId);
		if (!file) return;
		this.deps.setSelfOpenedPath(file.path);

		const openLeafIds: string[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => openLeafIds.push(leafId(leaf)));
		const companionLeafId = this.deps.getCompanionLeafId();
		const action = chooseCompanionAction(companionLeafId, openLeafIds, leafId(this.leaf));
		const companion =
			action === "reuse" && companionLeafId !== null
				? this.app.workspace.getLeafById(companionLeafId)
				: null;
		// Split from the graph pane, not whichever pane currently has focus.
		const target = companion ?? this.app.workspace.createLeafBySplit(this.leaf, "vertical");
		this.deps.setCompanionLeafId(leafId(target));
		// Keep the graph focused while the note opens beside it.
		void target.openFile(file, { active: false });
	}

	revealNode(nodeId: number): void {
		const file = this.nodeFile(nodeId);
		const explorer = this.fileExplorer();
		if (!file || !explorer) return;
		void this.app.workspace.revealLeaf(explorer.leaf);
		explorer.view.revealInFolder(file);
	}

	nodeFile(nodeId: number): TFile | null {
		const path = this.model?.nodes[nodeId]?.path;
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	fileExplorer(): { leaf: WorkspaceLeaf; view: FileExplorerView } | null {
		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			const view = asFileExplorer(leaf.view);
			if (view) return { leaf, view };
		}
		return null;
	}
}

function asFileExplorer(view: View): FileExplorerView | null {
	const candidate = view as Partial<FileExplorerView>;
	return typeof candidate.revealInFolder === "function" ? (view as FileExplorerView) : null;
}

function leafId(leaf: WorkspaceLeaf): string {
	const id = (leaf as WorkspaceLeaf & { id?: unknown }).id;
	return typeof id === "string" ? id : "";
}
