/**
 * Real-Chromium benchmark for the two rendering steps still unproven in the
 * plan: label rasterization (step 5) and per-node sprites (step 6).
 *
 * Node can't answer this — pixi's Text needs a canvas for metrics, and jsdom's
 * fake metrics would give numbers that don't match Electron. So this runs in an
 * actual browser against an actual WebGL context.
 */
import {
	Application,
	BitmapFont,
	BitmapText,
	Container,
	Sprite,
	Text,
	Texture,
} from "pixi.js";

const LABEL_COUNTS = [150, 500, 1500];
const NODE_COUNTS = [3000, 10000];
const FONT_SIZE = 11;
const FRAMES = 60;

/** Note names with the mix a real vault has: latin, cyrillic, digits. */
function makeNames(count: number): string[] {
	const words = ["Заметка", "Project", "Идея", "Meeting", "Проект", "Draft", "Обзор"];
	return Array.from({ length: count }, (_, i) => `${words[i % words.length]} ${i}`);
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

interface Row {
	name: string;
	ms: number;
	note: string;
}

const rows: Row[] = [];

function record(name: string, ms: number, note = ""): void {
	rows.push({ name, ms, note });
	const line = document.createElement("div");
	line.textContent = `${name.padEnd(46)} ${ms.toFixed(3)} ms  ${note}`;
	document.getElementById("out")!.appendChild(line);
}

async function main(): Promise<void> {
	const app = new Application();
	await app.init({ width: 1280, height: 800, antialias: true });
	document.getElementById("stage")!.appendChild(app.canvas);

	const layer = new Container();
	app.stage.addChild(layer);

	// ---- Step 5: label creation -------------------------------------------
	// The renderer budgets NEW_LABELS_PER_FRAME = 4 because Text is assumed
	// expensive. Measure what one label actually costs.
	for (const count of LABEL_COUNTS) {
		const names = makeNames(count);

		const textStart = performance.now();
		const texts = names.map((name) => new Text({ text: name, style: { fontSize: FONT_SIZE, fill: 0xffffff } }));
		// Reading width forces metrics + rasterization, which is the cost under test.
		let textWidthSum = 0;
		for (const t of texts) textWidthSum += t.width;
		const textMs = performance.now() - textStart;
		record(`Text × ${count} (создание)`, textMs, `${(textMs / count).toFixed(4)} мс/метка, Σw=${textWidthSum.toFixed(0)}`);
		for (const t of texts) t.destroy();

		BitmapFont.install({
			name: "bench",
			style: { fontSize: FONT_SIZE, fill: 0xffffff },
			chars: [["а", "я"], ["А", "Я"], ["a", "z"], ["A", "Z"], ["0", "9"], " "],
		});
		const bitmapStart = performance.now();
		const bitmaps = names.map((name) => new BitmapText({ text: name, style: { fontFamily: "bench", fontSize: FONT_SIZE } }));
		let bitmapWidthSum = 0;
		for (const b of bitmaps) bitmapWidthSum += b.width;
		const bitmapMs = performance.now() - bitmapStart;
		record(`BitmapText × ${count} (создание)`, bitmapMs, `${(bitmapMs / count).toFixed(4)} мс/метка, Σw=${bitmapWidthSum.toFixed(0)}`);
		for (const b of bitmaps) b.destroy();
	}

	// ---- Step 6: per-node sprite sync --------------------------------------
	// Every tick the renderer writes position/scale/tint on every node sprite.
	// That per-frame cost, not construction, is what ParticleContainer targets.
	for (const count of NODE_COUNTS) {
		const sprites: Sprite[] = [];
		const createStart = performance.now();
		for (let i = 0; i < count; i++) {
			const sprite = new Sprite(Texture.WHITE);
			sprite.anchor.set(0.5);
			layer.addChild(sprite);
			sprites.push(sprite);
		}
		record(`Sprite × ${count} (создание)`, performance.now() - createStart);

		const frameTimes: number[] = [];
		for (let frame = 0; frame < FRAMES; frame++) {
			const start = performance.now();
			for (let i = 0; i < count; i++) {
				const sprite = sprites[i];
				sprite.x = (i % 100) * 12 + frame;
				sprite.y = Math.floor(i / 100) * 8;
				sprite.scale.set(0.5 + (i % 10) / 20);
				sprite.tint = 0x63b3ed;
				sprite.alpha = 0.8;
			}
			app.renderer.render(app.stage);
			frameTimes.push(performance.now() - start);
		}
		record(`Sprite × ${count} (синхр. + отрисовка кадра)`, median(frameTimes), "медиана 60 кадров");

		for (const sprite of sprites) sprite.destroy();
		layer.removeChildren();
	}

	document.getElementById("done")!.textContent = "READY";
	(window as unknown as { benchRows: Row[] }).benchRows = rows;
}

main().catch((error) => {
	document.getElementById("out")!.textContent = `FAILED: ${String(error)}\n${(error as Error).stack ?? ""}`;
	document.getElementById("done")!.textContent = "READY";
});
