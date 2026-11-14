import type { HoverParent, HoverPopover } from "obsidian";

interface HoverPayload {
	event: MouseEvent;
	source: string;
	hoverParent: HoverParent;
	targetEl: HTMLElement;
	linktext: string;
}

/** One native preview session per graph opening, tied to its original window. */
export class NativeHoverPreview implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private path: string | null = null;
	private pointer: MouseEvent | null = null;
	private activePath: string | null = null;
	private disposed = false;
	private readonly hostDocument: Document;
	private readonly hostWindow: NonNullable<Document["defaultView"]>;

	constructor(
		private readonly targetEl: HTMLElement,
		private readonly source: string,
		private readonly trigger: (name: "hover-link", payload: HoverPayload) => void,
		private readonly resolvePath: (clientX: number, clientY: number) => string | null,
	) {
		this.hostDocument = targetEl.ownerDocument;
		const hostWindow = this.hostDocument.defaultView;
		if (!hostWindow) throw new Error("Graph preview requires a document window");
		this.hostWindow = hostWindow;
		this.hostDocument.addEventListener("keydown", this.onKey);
		this.hostDocument.addEventListener("keyup", this.onKey);
		this.hostDocument.addEventListener("pointerdown", this.onPointerDown, true);
		targetEl.addEventListener("pointerleave", this.onPointerLeave);
		hostWindow.addEventListener("blur", this.onBlur);
	}

	hover(path: string | null, event: MouseEvent): void {
		if (this.disposed || this.insidePopover(event.target)) return;
		if (event.target && (!(event.target instanceof this.hostWindow.Node) || !this.targetEl.contains(event.target))) {
			this.clear();
			return;
		}
		this.path = path;
		this.pointer = path ? event : null;
		if (!path || (!event.metaKey && !event.ctrlKey) || event.buttons) {
			this.closePopover();
			return;
		}
		this.show(path, event);
	}

	clear(): void {
		this.path = null;
		this.pointer = null;
		this.closePopover();
	}

	private show(path: string, event: MouseEvent): void {
		if (this.activePath === path) return;
		this.closePopover();
		this.activePath = path;
		this.trigger("hover-link", { event, source: this.source, hoverParent: this, targetEl: this.targetEl, linktext: path });
	}

	private closePopover(): void {
		this.activePath = null;
		const popover = this.hoverPopover;
		this.hoverPopover = null;
		popover?.unload();
	}

	private insidePopover(target: EventTarget | null): boolean {
		return target instanceof this.hostWindow.Node && !!this.hoverPopover?.hoverEl?.contains(target);
	}

	private onKey = (event: KeyboardEvent): void => {
		if (this.disposed) return;
		if (!this.targetEl.isConnected || !this.targetEl.isShown()) { this.clear(); return; }
		if (!event.metaKey && !event.ctrlKey) { this.closePopover(); return; }
		if (!this.path || !this.pointer || this.pointer.buttons) return;
		this.path = this.resolvePath(this.pointer.clientX, this.pointer.clientY);
		if (!this.path) { this.clear(); return; }
		const pointer = new this.hostWindow.MouseEvent("mousemove", {
			clientX: this.pointer.clientX, clientY: this.pointer.clientY,
			metaKey: event.metaKey, ctrlKey: event.ctrlKey,
		});
		this.show(this.path, pointer);
	};

	private onPointerDown = (event: Event): void => {
		if (!this.insidePopover(event.target)) this.clear();
	};
	private onPointerLeave = (event: PointerEvent): void => {
		if (!this.insidePopover(event.relatedTarget)) this.clear();
	};
	private onBlur = (): void => { this.clear(); };

	destroy(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clear();
		this.hostDocument.removeEventListener("keydown", this.onKey);
		this.hostDocument.removeEventListener("keyup", this.onKey);
		this.hostDocument.removeEventListener("pointerdown", this.onPointerDown, true);
		this.targetEl.removeEventListener("pointerleave", this.onPointerLeave);
		this.hostWindow.removeEventListener("blur", this.onBlur);
	}
}
