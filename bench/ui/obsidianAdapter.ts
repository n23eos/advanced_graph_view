type Dispose = () => void;

const iconPaths: Record<string, string> = {
	search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
	"bookmark-plus": '<path d="M6 3h12v18l-6-4-6 4z"></path><path d="M12 7v6M9 10h6"></path>',
	"sliders-horizontal": '<path d="M4 7h6M14 7h6M4 17h10M18 17h2"></path><circle cx="12" cy="7" r="2"></circle><circle cx="16" cy="17" r="2"></circle>',
	x: '<path d="M6 6l12 12M18 6 6 18"></path>',
	play: '<path d="m8 5 11 7-11 7z"></path>',
	pause: '<path d="M9 5v14M15 5v14"></path>',
	eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="2.5"></circle>',
	"eye-off": '<path d="m3 3 18 18M10.5 5.2A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-2.1 3M6.2 6.2C3.6 8.1 2 12 2 12s4 7 10 7a9 9 0 0 0 4.1-1"></path>',
	"file-text": '<path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6"></path>',
	waypoints: '<circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="18" r="2"></circle><path d="M8 6h4a4 4 0 0 1 4 4v6"></path>',
	route: '<circle cx="5" cy="19" r="2"></circle><circle cx="19" cy="5" r="2"></circle><path d="M7 19h4a4 4 0 0 0 4-4v-6a4 4 0 0 1 4-4"></path>',
	pin: '<path d="m12 17-5 5M8 3l8 8M14 2l8 8-4 1-6 6-1 4-8-8 4-1 6-6z"></path>',
	"locate-fixed": '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>',
	"panel-right": '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M15 4v16"></path>',
	orbit: '<circle cx="12" cy="12" r="2"></circle><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(35 12 12)"></ellipse>',
	"rotate-3d": '<circle cx="12" cy="12" r="8"></circle><path d="M8 9h5l-2 2a3 3 0 1 0 4 4"></path>',
	expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path>',
	maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path>',
	"rotate-ccw": '<path d="M3 8V3h5M4 4a9 9 0 1 1-1 12"></path>',
	compass: '<circle cx="12" cy="12" r="9"></circle><path d="m15 9-2 5-5 2 2-5z"></path>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path>',
	history: '<path d="M3 12a9 9 0 1 0 3-7M3 4v5h5M12 7v5l3 2"></path>',
};

export function setIcon(element: HTMLElement, name: string): void {
	element.empty();
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("svg-icon");
	svg.innerHTML = iconPaths[name] ?? '<circle cx="12" cy="12" r="8"></circle>';
	element.appendChild(svg);
}

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension = "md";
	parent: { path: string };
	stat: { ctime: number; mtime: number; size: number };
	constructor(path: string, stat: { ctime: number; mtime: number; size: number }) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		this.basename = this.name.replace(/\.md$/i, "");
		this.parent = { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" };
		this.stat = stat;
	}
}

export class ItemView {
	app: any;
	contentEl: HTMLElement;
	leaf: any;
	private disposers: Dispose[] = [];
	constructor(leaf: any) {
		this.leaf = leaf;
		this.app = leaf.app;
		this.contentEl = leaf.contentEl;
	}
	register(dispose: Dispose): void { this.disposers.push(dispose); }
	registerEvent(ref: { off?: Dispose } | Dispose): void {
		this.register(typeof ref === "function" ? ref : () => ref.off?.());
	}
	registerDomEvent(target: EventTarget, type: string, callback: EventListener, options?: AddEventListenerOptions): void {
		target.addEventListener(type, callback, options);
		this.register(() => target.removeEventListener(type, callback, options));
	}
	unload(): void {
		for (const dispose of this.disposers.splice(0).reverse()) dispose();
	}
}

export function debounce<T extends (...args: any[]) => any>(callback: T, delay: number): T & { cancel(): void } {
	let timer: number | null = null;
	const wrapped = ((...args: Parameters<T>) => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => { timer = null; callback(...args); }, delay);
	}) as T & { cancel(): void };
	wrapped.cancel = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
	return wrapped;
}

export const Keymap = {
	isModEvent(event: MouseEvent | KeyboardEvent): string | false {
		return event.metaKey ? "Meta" : event.ctrlKey ? "Ctrl" : event.altKey ? "Alt" : event.shiftKey ? "Shift" : false;
	},
};

export function getAllTags(cache: any): string[] | null {
	const tags = cache?.tags;
	if (!Array.isArray(tags)) return null;
	return tags.map((tag) => typeof tag === "string" ? tag : tag.tag).filter(Boolean);
}

class MenuItem {
	constructor(private readonly button: HTMLButtonElement) {}
	setTitle(title: string): this { this.button.textContent = title; return this; }
	setIcon(): this { return this; }
	setChecked(checked: boolean): this { if (checked) this.button.textContent = `✓ ${this.button.textContent}`; return this; }
	setDisabled(disabled: boolean): this { this.button.disabled = disabled; return this; }
	onClick(callback: () => void): this { this.button.addEventListener("click", callback); return this; }
}

export class Menu {
	private root = document.createElement("div");
	constructor() { this.root.className = "menu"; }
	addItem(configure: (item: MenuItem) => unknown): this {
		const button = document.createElement("button");
		button.className = "menu-item";
		this.root.appendChild(button);
		configure(new MenuItem(button));
		button.addEventListener("click", () => this.root.remove());
		return this;
	}
	addSeparator(): this { const line = document.createElement("div"); line.className = "menu-separator"; this.root.appendChild(line); return this; }
	showAtMouseEvent(event: MouseEvent): void { this.showAtPosition({ x: event.clientX, y: event.clientY }); }
	showAtPosition(position: { x: number; y: number }): void {
		document.querySelectorAll(".menu").forEach((menu) => menu.remove());
		this.root.style.left = `${position.x}px`;
		this.root.style.top = `${position.y}px`;
		document.body.appendChild(this.root);
	}
}

export class Notice {
	private element = document.createElement("div");
	constructor(message?: string | DocumentFragment, timeout = 4000) {
		this.element.className = "notice";
		if (typeof message === "string") this.element.textContent = message;
		else if (message) this.element.appendChild(message);
		document.body.appendChild(this.element);
		if (timeout > 0) window.setTimeout(() => this.hide(), timeout);
	}
	hide(): void { this.element.remove(); }
}

export class Modal {
	app: any;
	contentEl = document.createElement("div");
	titleEl = document.createElement("h3");
	private container = document.createElement("div");
	constructor(app?: any) { this.app = app; }
	open(): void {
		this.container.className = "modal-container";
		const modal = document.createElement("div");
		modal.className = "modal";
		modal.append(this.titleEl, this.contentEl);
		this.container.appendChild(modal);
		document.body.appendChild(this.container);
		this.onOpen();
	}
	close(): void { this.onClose(); this.container.remove(); }
	onOpen(): void {}
	onClose(): void {}
}

class ButtonComponent {
	buttonEl = document.createElement("button");
	setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
	setDestructive(): this { return this; }
	setCta(): this { return this; }
	onClick(callback: () => void): this { this.buttonEl.addEventListener("click", callback); return this; }
}

class TextComponent {
	inputEl = document.createElement("input");
	setValue(value: string): this { this.inputEl.value = value; return this; }
	onChange(callback: (value: string) => void): this { this.inputEl.addEventListener("input", () => callback(this.inputEl.value)); return this; }
}

export class Setting {
	settingEl = document.createElement("div");
	constructor(container: HTMLElement) { container.appendChild(this.settingEl); }
	setName(): this { return this; }
	setDesc(): this { return this; }
	addButton(configure: (button: ButtonComponent) => unknown): this { const button = new ButtonComponent(); this.settingEl.appendChild(button.buttonEl); configure(button); return this; }
	addText(configure: (text: TextComponent) => unknown): this { const text = new TextComponent(); this.settingEl.appendChild(text.inputEl); configure(text); return this; }
}

export abstract class FuzzySuggestModal<T> extends Modal {
	inputEl = document.createElement("input");
	emptyStateText = "";
	setPlaceholder(text: string): this { this.inputEl.placeholder = text; return this; }
	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, event?: MouseEvent | KeyboardEvent): void;
}

export type App = any;
export type TAbstractFile = any;
export type View = any;
export type WorkspaceLeaf = any;
