import { FuzzySuggestModal, type App } from "obsidian";
import type { GraphNode } from "../data/GraphStore";
import { t } from "../i18n";

/** Use the host's fuzzy search and keyboard navigation; paths distinguish names. */
export class ExploreNoteModal extends FuzzySuggestModal<GraphNode> {
	constructor(
		app: App,
		private readonly items: () => GraphNode[],
		private readonly choose: (path: string) => void,
		private readonly dismiss: () => void,
	) {
		super(app);
		this.setPlaceholder(t("explore.choose.placeholder"));
		this.emptyStateText = t("explore.choose.empty");
	}

	getItems(): GraphNode[] { return this.items(); }
	getItemText(node: GraphNode): string { return node.path; }
	onChooseItem(node: GraphNode): void { this.choose(node.path); }
	onClose(): void {
		super.onClose();
		this.dismiss();
	}
}
