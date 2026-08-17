/**
 * Cursor mode selector: what a left click on a node does.
 * A compact single row of monochrome icon buttons in the top-left corner.
 */
import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { ResponsiveMode } from "./responsive";

export type CursorTool = "open" | "links" | "path" | "hide" | "pin";

export interface ToolBarCallbacks {
	onToolChange(tool: CursorTool): void;
	onDepthChange(depth: number): void;
	onToggleFollow(enabled: boolean): void;
	onToggleSidePane(enabled: boolean): void;
	onOpenLocalGraph(): void;
	/** F-04: open the overflow menu with the actions hidden at this width. */
	onOverflowMenu(anchor: HTMLElement): void;
}

/** Lucide icon names — theme-tinted, so every glyph shares one tone. */
const TOOLS: { id: CursorTool; icon: string }[] = [
	{ id: "open", icon: "file-text" },
	{ id: "links", icon: "waypoints" },
	{ id: "path", icon: "route" },
	{ id: "hide", icon: "eye-off" },
	{ id: "pin", icon: "pin" },
];

export class ToolBar {
	private root: HTMLElement;
	private buttons = new Map<CursorTool, HTMLElement>();
	private depthRow: HTMLElement;
	private depthValue: HTMLElement;
	private followButton!: HTMLElement;
	private sidePaneButton!: HTMLElement;
	private statusEl!: HTMLElement;
	private badgesEl!: HTMLElement;
	/** Which of the two path picks comes next; only meaningful for "path". */
	private pathStage: "start" | "end" = "start";
	/** In compact/minimal the status shows the tool's short name only (F-04). */
	private responsiveMode: ResponsiveMode = "full";

	constructor(
		host: HTMLElement,
		private tool: CursorTool,
		depth: number,
		private following: boolean,
		private sidePane: boolean,
		private readonly callbacks: ToolBarCallbacks
	) {
		this.root = host.createDiv({ cls: "graph-insight-toolbar" });

		for (const item of TOOLS) {
			const button = this.root.createEl("button", { cls: "graph-insight-tool" });
			setIcon(button, item.icon);
			const description = `${t(`tool.${item.id}`)} — ${t(`tool.${item.id}.hint`)}`;
			// aria-label only: Obsidian renders its own tooltip from it, and a
			// `title` on top of that would stack the OS tooltip under it.
			button.setAttribute("aria-label", description);
			button.addEventListener("click", () => this.setTool(item.id));
			this.buttons.set(item.id, button);
		}

		// Not a cursor tool but a standing mode, so it sits in its own group
		// rather than joining the row of click behaviours.
		const followGroup = this.root.createDiv({ cls: "graph-insight-toolbar-group" });
		this.followButton = followGroup.createEl("button", { cls: "graph-insight-tool" });
		setIcon(this.followButton, "locate-fixed");
		const followDescription = `${t("tool.follow")} — ${t("tool.follow.hint")}`;
		this.followButton.setAttribute("aria-label", followDescription);
		this.followButton.addEventListener("click", () => {
			this.setFollowing(!this.following);
			this.callbacks.onToggleFollow(this.following);
		});

		this.sidePaneButton = followGroup.createEl("button", { cls: "graph-insight-tool" });
		setIcon(this.sidePaneButton, "panel-right");
		const sidePaneDescription = `${t("tool.sidePane")} — ${t("tool.sidePane.hint")}`;
		this.sidePaneButton.setAttribute("aria-label", sidePaneDescription);
		this.sidePaneButton.addEventListener("click", () => {
			this.setSidePane(!this.sidePane);
			this.callbacks.onToggleSidePane(this.sidePane);
		});

		const localGraphButton = followGroup.createEl("button", { cls: "graph-insight-tool" });
		setIcon(localGraphButton, "orbit");
		localGraphButton.setAttribute("aria-label", t("tool.localGraph"));
		localGraphButton.addEventListener("click", () => this.callbacks.onOpenLocalGraph());

		// Visible only in compact/minimal (CSS); collects the hidden actions.
		const overflowButton = this.root.createEl("button", {
			cls: "graph-insight-tool graph-insight-toolbar-overflow",
			text: "…",
		});
		overflowButton.setAttribute("aria-label", t("toolbar.more"));
		overflowButton.addEventListener("click", () => this.callbacks.onOverflowMenu(overflowButton));

		// Depth control lives inline; only meaningful in the neighborhood mode.
		this.depthRow = this.root.createDiv({ cls: "graph-insight-toolbar-depth" });
		const slider = this.depthRow.createEl("input", { type: "range" });
		slider.min = "1";
		slider.max = "6";
		slider.step = "1";
		slider.value = String(depth);
		slider.setAttribute("aria-label", t("tool.depth"));
		this.depthValue = this.depthRow.createSpan({
			cls: "graph-insight-panel-count",
			text: String(depth),
		});
		slider.addEventListener("input", () => {
			this.depthValue.setText(slider.value);
			this.callbacks.onDepthChange(Number(slider.value));
		});

		// F-08: what the active tool will do, as text — not a data attribute.
		const statusRow = this.root.createDiv({ cls: "graph-insight-toolbar-statusrow" });
		this.statusEl = statusRow.createSpan({
			cls: "graph-insight-toolbar-status",
			attr: { "aria-live": "polite" },
		});
		this.badgesEl = statusRow.createDiv({ cls: "graph-insight-toolbar-badges" });

		this.applyActive();
	}

	/** GraphView reports which path pick is expected next. */
	setPathStage(stage: "start" | "end"): void {
		this.pathStage = stage;
		this.renderStatus();
	}

	/** Narrow views keep the badge row but shorten the instruction (F-04). */
	setResponsiveMode(mode: ResponsiveMode): void {
		this.responsiveMode = mode;
		this.renderStatus();
	}

	private statusText(): string {
		if (this.responsiveMode !== "full") return t(`tool.${this.tool}`);
		if (this.tool === "path") {
			return this.pathStage === "start" ? t("tool.status.pathStart") : t("tool.status.pathEnd");
		}
		const byTool = {
			open: "tool.status.open",
			links: "tool.status.links",
			hide: "tool.status.hide",
			pin: "tool.status.pin",
		} as const;
		return t(byTool[this.tool]);
	}

	private renderStatus(): void {
		this.statusEl.setText(this.statusText());
		this.badgesEl.empty();
		if (this.following) {
			this.badgesEl.createSpan({ cls: "graph-insight-toolbar-badge", text: t("tool.follow") });
		}
		if (this.sidePane) {
			this.badgesEl.createSpan({ cls: "graph-insight-toolbar-badge", text: t("tool.sidePane") });
		}
	}

	/** Reflect the state without firing the callback — for the command palette,
	 *  which flips the setting and then tells the bar about it. */
	setFollowing(following: boolean): void {
		this.following = following;
		this.applyActive();
	}

	setSidePane(sidePane: boolean): void {
		this.sidePane = sidePane;
		this.applyActive();
	}

	private setTool(tool: CursorTool): void {
		this.tool = tool;
		this.pathStage = "start";
		this.applyActive();
		this.callbacks.onToolChange(tool);
	}

	private applyActive(): void {
		for (const [id, button] of this.buttons) {
			button.toggleClass("is-active", id === this.tool);
		}
		this.depthRow.toggleClass("is-hidden", this.tool !== "links");
		this.followButton?.toggleClass("is-active", this.following);
		this.sidePaneButton?.toggleClass("is-active", this.sidePane);
		this.renderStatus();
	}

	destroy(): void {
		this.root.remove();
	}
}
