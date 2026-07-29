/**
 * What the graph should do when the active note changes and "follow active
 * note" is on.
 *
 * The rules are all about staying out of the way: three other things can be
 * driving the camera or the view at that moment, and each of them outranks
 * following. Kept as a pure function so the precedence is stated once and
 * checked, rather than being re-read out of an if-chain in the event handler.
 */

export type FollowAction =
	/** Pan the camera to the note and light it up. */
	| "center"
	/** Focus mode is on: rebuild its neighborhood around the new note. */
	| "refocus"
	/** Something else owns this moment. */
	| "ignore";

export interface FollowContext {
	enabled: boolean;
	/** The graph pane is actually on screen, not behind another tab. */
	graphVisible: boolean;
	exploring: boolean;
	focused: boolean;
	/** The graph opened this note itself — following it would chase its own tail. */
	openedByGraph: boolean;
	/** The path resolves to a node: markdown, and present in the current model. */
	inGraph: boolean;
	/** The active search or chip filter excludes the node. */
	filteredOut: boolean;
}

export function resolveFollowAction(context: FollowContext): FollowAction {
	if (!context.enabled || !context.graphVisible) return "ignore";
	// Explore mode flies the camera along links; a pan mid-flight lands it
	// somewhere it never chose.
	if (context.exploring) return "ignore";
	if (context.openedByGraph) return "ignore";
	if (!context.inGraph) return "ignore";
	// The note is deliberately filtered out. Panning to an invisible node looks
	// broken, and silently dropping the filter throws away what the user asked for.
	if (context.filteredOut) return "ignore";
	return context.focused ? "refocus" : "center";
}
