/**
 * Tool-set arithmetic for read-only mode (PLAN D1, §5.2).
 *
 * Kept separate from index.ts and free of ExtensionAPI so the restore rule can
 * be unit-tested — it is the part most likely to break in a way the user only
 * notices later.
 */

import { KNOWN_BUILTIN_TOOLS, WRITE_TOOLS } from "./config.ts";

/** Tools to disable, given what is currently active. */
export function toolsToDisable(active: readonly string[]): string[] {
	return active.filter((name) => (WRITE_TOOLS as readonly string[]).includes(name));
}

/** Active set after disabling. */
export function applyDisable(active: readonly string[], disabled: readonly string[]): string[] {
	return active.filter((name) => !disabled.includes(name));
}

/**
 * Active set after re-enabling.
 *
 * Adds back only what we removed, on top of whatever is active *now* — so a
 * tool the user turned off by hand while grounded mode was on stays off
 * (PLAN §5.2, and the M0 acceptance check that covers it).
 */
export function applyRestore(active: readonly string[], disabled: readonly string[]): string[] {
	const out = [...active];
	for (const name of disabled) {
		if (!out.includes(name)) out.push(name);
	}
	return out;
}

/**
 * Write-capable tools we do not know about. Only used for an advisory notice:
 * the read-only claim is about `edit`/`write`, and PLAN N1 already says this is
 * not a security boundary.
 */
export function unknownTools(allToolNames: readonly string[]): string[] {
	return allToolNames.filter(
		(name) => !(KNOWN_BUILTIN_TOOLS as readonly string[]).includes(name),
	);
}
