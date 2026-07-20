/**
 * Thin worker shell around layoutEngine. Bundled to a string by esbuild
 * (inline-worker plugin) and spawned via a Blob URL from LayoutClient.
 */
import { createLayoutEngine, type EngineInMessage } from "./layoutEngine";

const workerScope = self as unknown as {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<EngineInMessage>) => void) | null;
};

const engine = createLayoutEngine((message, transfer) => {
	workerScope.postMessage(message, transfer);
});

workerScope.onmessage = (event) => {
	engine.handle(event.data);
};
