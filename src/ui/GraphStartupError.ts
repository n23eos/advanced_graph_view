import { t } from "../i18n";

/** Replace a failed graph surface with one clear recovery action. */
export function renderGraphStartupError(host: HTMLElement, onRetry: () => Promise<void>): HTMLElement {
	host.empty();
	const card = host.createDiv({ cls: "graph-insight-empty graph-insight-startup-error" });
	card.createDiv({ cls: "graph-insight-empty-title", text: t("startup.error.title") });
	card.createDiv({ cls: "graph-insight-empty-body", text: t("startup.error.body") });
	const retry = card.createEl("button", {
		cls: "graph-insight-startup-retry",
		text: t("startup.error.retry"),
	});
	retry.addEventListener("click", () => {
		retry.disabled = true;
		void onRetry().catch((error) => {
			console.error("Advanced Graph View: startup retry failed", error);
			if (card.isConnected) retry.disabled = false;
		});
	});
	return card;
}
