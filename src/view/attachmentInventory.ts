import type { Vault } from "obsidian";

/** Unlinked attachment changes need not cause a Markdown metadata pass. */
export function watchAttachmentInventory(vault: Vault, refresh: () => void): () => void {
	const refs = [vault.on("create", refresh), vault.on("delete", refresh), vault.on("rename", refresh)];
	return () => { for (const ref of refs) vault.offref(ref); };
}
