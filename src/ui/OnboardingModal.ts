import { Modal, type App } from "obsidian";
import { t } from "../i18n";

/** How the user left the tour; maps straight onto OnboardingState. */
export type OnboardingResult = "dismissed" | "completed" | "disabled";

const STEPS = [
	{ title: "onboarding.step1.title", body: "onboarding.step1.body" },
	{ title: "onboarding.step2.title", body: "onboarding.step2.body" },
	{ title: "onboarding.step3.title", body: "onboarding.step3.body" },
] as const;

/** Three-step action tour: pick a note, try a filter, launch Explore.
 *  Closing with the X counts as Skip, never as "don't show again". */
export class OnboardingModal extends Modal {
	private step = 0;
	private result: OnboardingResult = "dismissed";
	private reported = false;

	constructor(app: App, private readonly onResult: (result: OnboardingResult) => void) {
		super(app);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.report();
		this.contentEl.empty();
	}

	private report(): void {
		if (this.reported) return;
		this.reported = true;
		this.onResult(this.result);
	}

	private finish(result: OnboardingResult): void {
		this.result = result;
		this.close();
		// The stock Modal.close() triggers onClose → report(); this covers
		// subclasses/tests where close() is a no-op.
		this.report();
	}

	private render(): void {
		const step = STEPS[this.step];
		this.titleEl.setText(t("onboarding.title"));
		this.contentEl.empty();
		this.contentEl.createEl("h5", { text: t(step.title) });
		this.contentEl.createEl("p", { text: t(step.body) });

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const never = buttons.createEl("button", { text: t("onboarding.never") });
		never.addEventListener("click", () => this.finish("disabled"));
		const skip = buttons.createEl("button", { text: t("onboarding.skip") });
		skip.addEventListener("click", () => this.finish("dismissed"));
		const back = buttons.createEl("button", { text: t("onboarding.back") });
		back.disabled = this.step === 0;
		back.addEventListener("click", () => {
			this.step = Math.max(0, this.step - 1);
			this.render();
		});
		const next = buttons.createEl("button", { text: t("onboarding.next"), cls: "mod-cta" });
		next.addEventListener("click", () => {
			if (this.step === STEPS.length - 1) {
				this.finish("completed");
				return;
			}
			this.step++;
			this.render();
		});
	}
}
