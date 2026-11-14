/**
 * The subset of Obsidian's HTMLElement helpers the plugin's UI components use
 * (createEl, createDiv, createSpan, empty, setText, toggleClass, addClass),
 * installed onto jsdom's prototypes so components render in DOM tests without
 * the Obsidian runtime. The types come from Obsidian's global augmentation of
 * HTMLElement; this file only supplies the runtime behavior jsdom lacks.
 * Import and call from files annotated with `@vitest-environment jsdom`.
 */

interface TestDomElementInfo {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	parent?: Node;
	value?: string;
	type?: string;
	prepend?: boolean;
	placeholder?: string;
	href?: string;
}

function applyInfo(el: HTMLElement, info?: TestDomElementInfo | string): void {
	if (info === undefined) return;
	const options: TestDomElementInfo = typeof info === "string" ? { cls: info } : info;
	if (options.cls !== undefined) {
		// Obsidian accepts space-separated class strings; classList does not.
		const classes = (Array.isArray(options.cls) ? options.cls : [options.cls])
			.flatMap((cls) => cls.split(/\s+/))
			.filter(Boolean);
		el.classList.add(...classes);
	}
	if (typeof options.text === "string") el.textContent = options.text;
	else if (options.text) el.appendChild(options.text);
	if (options.title !== undefined) el.title = options.title;
	if (options.href !== undefined) (el as HTMLAnchorElement).href = options.href;
	if (options.type !== undefined) (el as HTMLInputElement).type = options.type;
	if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
	if (options.placeholder !== undefined) (el as HTMLInputElement).placeholder = options.placeholder;
	for (const [key, value] of Object.entries(options.attr ?? {})) {
		if (value === null) el.removeAttribute(key);
		else el.setAttribute(key, String(value));
	}
}

function attach(el: HTMLElement, info: TestDomElementInfo | string | undefined, fallback?: Node): void {
	const options = typeof info === "object" ? info : undefined;
	const parent = options?.parent ?? fallback;
	if (!parent) return;
	if (options?.prepend) parent.insertBefore(el, parent.firstChild);
	else parent.appendChild(el);
}

/** Idempotent: safe to call from every test file's setup. */
export function installObsidianDom(): void {
	const createGlobalEl = function <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		info?: TestDomElementInfo | string,
		callback?: (el: HTMLElementTagNameMap[K]) => void
	): HTMLElementTagNameMap[K] {
		const el = document.createElement(tag);
		applyInfo(el, info);
		attach(el, info);
		callback?.(el);
		return el;
	};
	const createGlobalFragment = function (callback?: (el: DocumentFragment) => void) {
		const fragment = document.createDocumentFragment();
		callback?.(fragment);
		return fragment;
	};
	const testGlobal = globalThis;
	testGlobal.createEl ??= createGlobalEl;
	testGlobal.createFragment ??= createGlobalFragment;
	window.createEl ??= testGlobal.createEl;
	window.createFragment ??= testGlobal.createFragment;

	const proto = HTMLElement.prototype;
	if (typeof proto.createEl === "function") return;

	proto.createEl = function <K extends keyof HTMLElementTagNameMap>(
		this: HTMLElement,
		tag: K,
		info?: TestDomElementInfo | string
	): HTMLElementTagNameMap[K] {
		const el = document.createElement(tag);
		applyInfo(el, info);
		attach(el, info, this);
		return el;
	};
	proto.createDiv = function (this: HTMLElement, info?: TestDomElementInfo | string) {
		return this.createEl("div", info);
	};
	proto.createSpan = function (this: HTMLElement, info?: TestDomElementInfo | string) {
		return this.createEl("span", info);
	};
	proto.empty = function (this: HTMLElement) {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
	};
	proto.toggleClass = function (this: HTMLElement, cls: string | string[], value: boolean) {
		for (const name of Array.isArray(cls) ? cls : [cls]) this.classList.toggle(name, value);
	};
	proto.addClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.add(...cls);
	};
	proto.removeClass = function (this: HTMLElement, ...cls: string[]) {
		this.classList.remove(...cls);
	};
	// Real Obsidian toggles display:none; the shim uses the `hidden` property
	// so tests assert visibility without inspecting inline styles.
	proto.hide = function (this: HTMLElement) {
		this.hidden = true;
		return this;
	};
	proto.show = function (this: HTMLElement) {
		this.hidden = false;
		return this;
	};
	proto.isShown = function (this: HTMLElement) {
		return !this.hidden;
	};
}
