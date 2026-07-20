/**
 * Cursor mode selector: what a left click on a node does.
 * Sits under the search bar as a compact row of buttons.
 */

export type CursorTool = "open" | "links" | "path" | "hide" | "pin";

export interface ToolBarCallbacks {
	onToolChange(tool: CursorTool): void;
	onDepthChange(depth: number): void;
}

const TOOLS: { id: CursorTool; icon: string; label: string; hint: string }[] = [
	{ id: "open", icon: "📄", label: "Открыть", hint: "Клик открывает заметку" },
	{ id: "links", icon: "🕸", label: "Связи", hint: "Клик показывает окружение на N шагов" },
	{ id: "path", icon: "↔", label: "Путь", hint: "Клик по двум заметкам — кратчайшая цепочка между ними" },
	{ id: "hide", icon: "🚫", label: "Скрыть", hint: "Клик убирает заметку с графа" },
	{ id: "pin", icon: "📌", label: "Закрепить", hint: "Клик закрепляет/освобождает заметку" },
];

export class ToolBar {
	private root: HTMLElement;
	private buttons = new Map<CursorTool, HTMLElement>();
	private depthRow: HTMLElement;
	private depthValue: HTMLElement;

	constructor(
		host: HTMLElement,
		private tool: CursorTool,
		depth: number,
		private readonly callbacks: ToolBarCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-toolbar" });

		const row = this.root.createDiv({ cls: "graph-insight-toolbar-row" });
		for (const item of TOOLS) {
			const button = row.createEl("button", {
				cls: "graph-insight-tool",
				text: `${item.icon} ${item.label}`,
			});
			button.setAttribute("aria-label", item.hint);
			button.addEventListener("click", () => this.setTool(item.id));
			this.buttons.set(item.id, button);
		}

		this.depthRow = this.root.createDiv({ cls: "graph-insight-toolbar-row" });
		this.depthRow.createSpan({ cls: "graph-insight-panel-label", text: "Шагов" });
		const slider = this.depthRow.createEl("input", { type: "range" });
		slider.min = "1";
		slider.max = "6";
		slider.step = "1";
		slider.value = String(depth);
		this.depthValue = this.depthRow.createSpan({
			cls: "graph-insight-panel-count",
			text: String(depth),
		});
		slider.addEventListener("input", () => {
			this.depthValue.setText(slider.value);
			this.callbacks.onDepthChange(Number(slider.value));
		});

		this.applyActive();
	}

	private setTool(tool: CursorTool): void {
		this.tool = tool;
		this.applyActive();
		this.callbacks.onToolChange(tool);
	}

	private applyActive(): void {
		for (const [id, button] of this.buttons) {
			button.toggleClass("is-active", id === this.tool);
		}
		// The depth slider only means something in the neighborhood mode.
		this.depthRow.toggleClass("is-hidden", this.tool !== "links");
	}

	setStatus(text: string): void {
		this.root.setAttribute("data-status", text);
	}

	destroy(): void {
		this.root.remove();
	}
}
