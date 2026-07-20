import { Modal, type App } from "obsidian";

/** Three-step intro shown on the first open of the graph view. */
export class OnboardingModal extends Modal {
	constructor(app: App, private readonly onDismissForever: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Graph Insight — what is different");
		const steps: [string, string][] = [
			[
				"1 · Nodes encode metrics",
				"Size = PageRank (actual importance), color = edit recency. The panel on the left reassigns the channels: opens, links, age, folders, tags, clusters.",
			],
			[
				"2 · Layers and filters",
				"Layers highlight orphans, dead ends and broken links. The search bar understands path:, tag:, opened:>10, edited:<30d. Double-click a node for focus mode, Shift+drag for lasso.",
			],
			[
				"3 · Semantic edges",
				"Enable semantics in the panel — dashed edges reveal notes that are similar in meaning but NOT linked. Click an edge to create the link.",
			],
		];
		for (const [title, body] of steps) {
			this.contentEl.createEl("h5", { text: title });
			this.contentEl.createEl("p", { text: body });
		}
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const done = buttons.createEl("button", { text: "Got it, do not show again", cls: "mod-cta" });
		done.addEventListener("click", () => {
			this.onDismissForever();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
