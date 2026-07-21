/**
 * Cursor mode selector: what a left click on a node does.
 * A compact single row of monochrome icon buttons in the top-left corner.
 */
import { setIcon } from "obsidian";

export type CursorTool = "open" | "links" | "path" | "hide" | "pin";

export interface ToolBarCallbacks {
	onToolChange(tool: CursorTool): void;
	onDepthChange(depth: number): void;
}

/** Lucide icon names — theme-tinted, so every glyph shares one tone. */
const TOOLS: { id: CursorTool; icon: string; label: string; hint: string }[] = [
	{ id: "open", icon: "file-text", label: "Open", hint: "Click opens the note" },
	{ id: "links", icon: "waypoints", label: "Links", hint: "Click reveals the neighborhood N steps out" },
	{ id: "path", icon: "route", label: "Path", hint: "Click two notes to trace the shortest chain between them" },
	{ id: "hide", icon: "eye-off", label: "Hide", hint: "Click removes the note from the graph" },
	{ id: "pin", icon: "pin", label: "Pin", hint: "Click pins or releases the note" },
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

		for (const item of TOOLS) {
			const button = this.root.createEl("button", { cls: "graph-insight-tool" });
			setIcon(button, item.icon);
			button.setAttribute("aria-label", `${item.label} — ${item.hint}`);
			button.setAttribute("title", `${item.label} — ${item.hint}`);
			button.addEventListener("click", () => this.setTool(item.id));
			this.buttons.set(item.id, button);
		}

		// Depth control lives inline; only meaningful in the neighborhood mode.
		this.depthRow = this.root.createDiv({ cls: "graph-insight-toolbar-depth" });
		const slider = this.depthRow.createEl("input", { type: "range" });
		slider.min = "1";
		slider.max = "6";
		slider.step = "1";
		slider.value = String(depth);
		slider.setAttribute("aria-label", "Neighborhood steps");
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
		this.depthRow.toggleClass("is-hidden", this.tool !== "links");
	}

	setStatus(text: string): void {
		this.root.setAttribute("data-status", text);
	}

	destroy(): void {
		this.root.remove();
	}
}
