/**
 * Local-graph coloring: a node's tint comes from its distance to the root, so
 * the rings read as rings. The active scheme's own gradient is sampled from
 * far (cold) to near (bright), which keeps the pane in the same palette the
 * main graph is using instead of a hardcoded ramp.
 */
import { sampleGradient, type ScalePreset } from "../encoding/colorScales";

export function ringTints(
	depths: Int16Array,
	maxDepth: number,
	preset: ScalePreset
): Int32Array {
	const tints = new Int32Array(depths.length);
	for (let i = 0; i < depths.length; i++) {
		// 1 = root (bright end), 0 = outermost ring (cold end).
		const nearness = maxDepth <= 0 ? 1 : 1 - depths[i] / maxDepth;
		tints[i] = sampleGradient(preset.stops, nearness);
	}
	return tints;
}
