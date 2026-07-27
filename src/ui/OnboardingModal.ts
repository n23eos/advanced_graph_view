import { Modal, type App } from "obsidian";
import { t } from "../i18n";

/** Three-step intro shown on the first open of the graph view. */
export class OnboardingModal extends Modal {
	constructor(app: App, private readonly onDismissForever: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t("onboarding.title"));
		const steps: [string, string][] = [
			[t("onboarding.step1.title"), t("onboarding.step1.body")],
			[t("onboarding.step2.title"), t("onboarding.step2.body")],
			[t("onboarding.step3.title"), t("onboarding.step3.body")],
		];
		for (const [title, body] of steps) {
			this.contentEl.createEl("h5", { text: title });
			this.contentEl.createEl("p", { text: body });
		}
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const done = buttons.createEl("button", { text: t("onboarding.dismiss"), cls: "mod-cta" });
		done.addEventListener("click", () => {
			this.onDismissForever();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
