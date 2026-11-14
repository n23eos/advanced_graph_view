// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { HoverPopover } from "obsidian";
import { NativeHoverPreview } from "./nativeHoverPreview";
import { installObsidianDom } from "../test/obsidianDom";
beforeAll(() => installObsidianDom());

function setup() {
	const canvas = createEl("canvas");
	document.body.append(canvas);
	const trigger = vi.fn<ConstructorParameters<typeof NativeHoverPreview>[2]>();
	const resolvePath = vi.fn((): string | null => "Folder/Note.md");
	const hover = new NativeHoverPreview(canvas, "graph-insight-view", trigger, resolvePath);
	const event = (modified = false) => new MouseEvent("pointermove", { clientX: 40, clientY: 60, ctrlKey: modified });
	const dispose = () => { hover.destroy(); canvas.remove(); };
	return { canvas, trigger, hover, event, dispose, resolvePath };
}

describe("native graph hover", () => {
	test("plain hover stays unchanged and modified hover sends a full path once", () => {
		const h = setup();
		try {
			h.hover.hover("Folder/Repeated.md", h.event());
			expect(h.trigger).not.toHaveBeenCalled();
			const event = h.event(true);
			for (let i = 0; i < 100; i++) h.hover.hover("Folder/Repeated.md", event);
			expect(h.trigger).toHaveBeenCalledExactlyOnceWith("hover-link", {
				event, source: "graph-insight-view", hoverParent: h.hover,
				targetEl: h.canvas, linktext: "Folder/Repeated.md",
			});
		} finally { h.dispose(); }
	});

	test("modifier press previews a stationary target, release closes exactly once", () => {
		const h = setup();
		const unload = vi.fn();
		try {
			h.hover.hover("Folder/Note.md", h.event());
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
			expect(h.trigger).toHaveBeenCalledOnce();
			expect(h.trigger.mock.calls[0][1].event).toMatchObject({ metaKey: true, clientX: 40, clientY: 60 });
			h.hover.hoverPopover = { unload } as unknown as HoverPopover;
			document.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
			h.hover.clear();
			expect(unload).toHaveBeenCalledOnce();
		} finally { h.dispose(); }
	});

	test("target changes unload previous popup and preserve duplicate basename paths", () => {
		const h = setup(); const unload = vi.fn();
		try {
			h.hover.hover("A/Note.md", h.event(true));
			h.hover.hoverPopover = { unload } as unknown as HoverPopover;
			h.hover.hover("B/Note.md", h.event(true));
			expect(unload).toHaveBeenCalledOnce();
			expect(h.trigger.mock.calls[1][1].linktext).toBe("B/Note.md");
			h.hover.hover(null, h.event(true));
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
			expect(h.trigger).toHaveBeenCalledTimes(2);
		} finally { h.dispose(); }
	});

	test.each(["pointerdown", "pointerleave", "blur", "destroy"])("cleans on %s and never uses a disposed target", (cause) => {
		const h = setup(); const unload = vi.fn();
		try {
			h.hover.hover("Note.md", h.event(true));
			h.hover.hoverPopover = { unload } as unknown as HoverPopover;
			if (cause === "destroy") h.hover.destroy();
			else if (cause === "blur") window.dispatchEvent(new Event("blur"));
			else h.canvas.dispatchEvent(new MouseEvent(cause, { bubbles: true }));
			expect(unload).toHaveBeenCalledOnce();
			h.hover.destroy();
			h.hover.hover("Other.md", h.event(true));
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
			expect(h.trigger).toHaveBeenCalledOnce();
		} finally { h.dispose(); }
	});

	test.each(["Other/Note.md", null])("stationary modifier resolves the current target after layout motion: %s", (path) => {
		const h = setup();
		try {
			h.hover.hover("Old.md", h.event());
			h.resolvePath.mockReturnValue(path);
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
			if (path) expect(h.trigger.mock.calls[0][1].linktext).toBe(path);
			else expect(h.trigger).not.toHaveBeenCalled();
		} finally { h.dispose(); }
	});

	test.each(["hidden", "detached"])("does not preview a %s graph when a modifier is pressed", (mode) => {
		const h = setup(); const unload = vi.fn();
		try {
			h.hover.hover("Note.md", h.event());
			h.hover.hoverPopover = { unload } as unknown as HoverPopover;
			if (mode === "hidden") h.canvas.hidden = true;
			else h.canvas.remove();
			document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }));
			expect(h.trigger).not.toHaveBeenCalled();
			expect(unload).toHaveBeenCalledOnce();
		} finally { h.dispose(); }
	});

	test("moving from canvas into the native popup allows interaction", () => {
		const h = setup(); const unload = vi.fn(); const popup = document.body.createDiv();
		const link = popup.appendChild(createEl("a")); document.body.append(popup);
		try {
			h.hover.hover("Note.md", h.event(true));
			h.hover.hoverPopover = { unload, hoverEl: popup } as unknown as HoverPopover;
			h.canvas.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: link }));
			link.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
			expect(unload).not.toHaveBeenCalled();
			h.hover.destroy();
			expect(unload).toHaveBeenCalledOnce();
		} finally { popup.remove(); h.dispose(); }
	});
});
