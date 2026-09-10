/**
 * The real filesystem implementation of `FileProbe`.
 *
 * Split out of index.ts so it can be exercised against actual files in tests —
 * the injected fake in citations.test.ts proves the logic, this proves the
 * wiring (line counting, size guard, unreadable paths).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { FileProbe } from "./citations.ts";
import { MAX_FILE_BYTES } from "./config.ts";

/** Line count for file content, with a trailing newline not opening a new line. */
export function countLinesIn(content: string): number {
	if (content.length === 0) return 0;
	const parts = content.split("\n");
	return content.endsWith("\n") ? parts.length - 1 : parts.length;
}

export function createFileProbe(
	cache: Map<string, number | undefined> = new Map(),
	maxBytes: number = MAX_FILE_BYTES,
): FileProbe {
	return {
		resolve: (root, relative) => path.resolve(root, relative),
		isAbsolute: (p) => path.isAbsolute(p),
		isFile: (p) => {
			try {
				return fs.statSync(p).isFile();
			} catch {
				return false;
			}
		},
		countLines: (p) => {
			if (cache.has(p)) return cache.get(p);
			let count: number | undefined;
			try {
				const { size } = fs.statSync(p);
				// Oversized files are left unmeasured on purpose: an unknown line
				// count means "accept", never "invalid" (PLAN T-1).
				if (size <= maxBytes) count = countLinesIn(fs.readFileSync(p, "utf8"));
			} catch {
				count = undefined;
			}
			cache.set(p, count);
			return count;
		},
	};
}
