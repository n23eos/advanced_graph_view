import { expect, test, vi } from "vitest";
import type { Vault } from "obsidian";
import { watchAttachmentInventory } from "./attachmentInventory";
test("attachment inventory events refresh without a metadata pass and detach on close", () => {
	const listeners = new Map<string, () => void>();
	const vault = {
		on: (name: string, callback: () => void) => { listeners.set(name, callback); return name; },
		offref: (name: string) => { listeners.delete(name); },
	};
	const refresh = vi.fn();
	const stop = watchAttachmentInventory(vault as unknown as Vault, refresh);
	for (const name of ["create", "delete", "rename"]) listeners.get(name)?.();
	expect(refresh).toHaveBeenCalledTimes(3);
	stop();
	expect(listeners.size).toBe(0);
});
