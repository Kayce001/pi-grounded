/**
 * Citation extraction, resolution, verification and verdict.
 *
 * This module never imports ExtensionAPI and never touches the real filesystem
 * directly — file access goes through the injected `FileProbe`, so every branch
 * here is unit-testable without running an LLM or writing to disk.
 */

import {
	CODE_EXTENSIONS,
	MAX_CITATIONS_PER_RUN,
	MIN_ANSWER_LENGTH,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface Citation {
	/** The reference exactly as it appeared, e.g. "src/a.ts:12". */
	raw: string;
	/** Path portion, still in whatever form the model wrote it. */
	path: string;
	line: number;
	endLine?: number;
}

/**
 * A citation must end in a known code extension AND carry a line number. Both
 * halves matter: the extension list keeps `v1.2:30` from looking like a file,
 * and requiring the line number keeps a bare filename from counting as a
 * source reference.
 *
 * The leading `[^\w.\-/\\:]` (or start of line) means a reference has to begin
 * at a real boundary, which is what stops URLs like `http://x/a.js:80` from
 * matching — the character before `a.js` is a slash.
 */
function buildPattern(): RegExp {
	const exts = CODE_EXTENSIONS.join("|");
	return new RegExp(
		// boundary
		String.raw`(?:^|[^\w.\-/\\:])` +
			// path: optional drive letter, optional leading slash, then segments
			String.raw`((?:[A-Za-z]:)?[\/\\]?(?:[\w.\-]+[\/\\])*[\w.\-]+\.(?:${exts}))` +
			// required :line, optional -endLine
			String.raw`:(\d+)(?:-(\d+))?`,
		"gm",
	);
}

const CITATION_PATTERN = buildPattern();

export function extractCitations(text: string): Citation[] {
	const out: Citation[] = [];
	const seen = new Set<string>();

	CITATION_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = CITATION_PATTERN.exec(text);
	while (match !== null) {
		const path = match[1];
		const lineRaw = match[2];
		const endRaw = match[3];

		if (path !== undefined && lineRaw !== undefined) {
			const line = Number.parseInt(lineRaw, 10);
			const endLine = endRaw === undefined ? undefined : Number.parseInt(endRaw, 10);
			const raw = endLine === undefined ? `${path}:${line}` : `${path}:${line}-${endLine}`;

			// Same reference repeated in one answer is one citation, not two.
			if (!seen.has(raw)) {
				seen.add(raw);
				out.push({
					raw,
					path,
					line,
					...(endLine === undefined ? {} : { endLine }),
				});
			}
		}

		if (out.length >= MAX_CITATIONS_PER_RUN) break;
		match = CITATION_PATTERN.exec(text);
	}

	return out;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type CitationStatus = "ok" | "file-not-found" | "line-out-of-range";

export interface CitationResult extends Citation {
	status: CitationStatus;
	/** Which root the path resolved against, when it resolved at all. */
	resolvedPath?: string;
	lineCount?: number;
}

/**
 * Injected filesystem access. Kept this small on purpose so tests can supply an
 * in-memory implementation.
 */
export interface FileProbe {
	/** Join a root and a relative path the way the host platform does. */
	resolve(root: string, relative: string): string;
	isAbsolute(path: string): boolean;
	/** True when the path exists AND is a regular file. */
	isFile(path: string): boolean;
	/**
	 * Line count, or undefined when the file could not be measured (too large,
	 * unreadable, binary). Undefined means "do not judge", never "invalid".
	 */
	countLines(path: string): number | undefined;
}

export function verifyCitation(
	citation: Citation,
	roots: readonly string[],
	probe: FileProbe,
): CitationResult {
	const candidates = probe.isAbsolute(citation.path)
		? [citation.path]
		: roots.map((root) => probe.resolve(root, citation.path));

	const resolvedPath = candidates.find((candidate) => probe.isFile(candidate));
	if (resolvedPath === undefined) {
		return { ...citation, status: "file-not-found" };
	}

	const lineCount = probe.countLines(resolvedPath);
	if (lineCount === undefined) {
		// Unmeasurable file: accept rather than risk a false positive (PLAN T-1).
		return { ...citation, status: "ok", resolvedPath };
	}

	// Files are 1-indexed, so line 0 is never valid.
	const highest = citation.endLine ?? citation.line;
	if (citation.line < 1 || highest > lineCount) {
		return { ...citation, status: "line-out-of-range", resolvedPath, lineCount };
	}

	return { ...citation, status: "ok", resolvedPath, lineCount };
}

export function verifyCitations(
	citations: readonly Citation[],
	roots: readonly string[],
	probe: FileProbe,
): CitationResult[] {
	return citations.map((citation) => verifyCitation(citation, roots, probe));
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type Verdict = "skipped" | "no-citation" | "verified" | "invalid";

export interface Judgement {
	verdict: Verdict;
	results: CitationResult[];
	invalid: CitationResult[];
	/** Only set when the verdict is "skipped". */
	skipReason?: "disabled" | "empty" | "too-short";
}

export interface JudgeOptions {
	enabled: boolean;
	minAnswerLength?: number;
}

export function judge(
	text: string,
	roots: readonly string[],
	probe: FileProbe,
	options: JudgeOptions,
): Judgement {
	const minLength = options.minAnswerLength ?? MIN_ANSWER_LENGTH;

	if (!options.enabled) {
		return { verdict: "skipped", results: [], invalid: [], skipReason: "disabled" };
	}

	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return { verdict: "skipped", results: [], invalid: [], skipReason: "empty" };
	}
	if (trimmed.length < minLength) {
		return { verdict: "skipped", results: [], invalid: [], skipReason: "too-short" };
	}

	const citations = extractCitations(text);
	if (citations.length === 0) {
		return { verdict: "no-citation", results: [], invalid: [] };
	}

	const results = verifyCitations(citations, roots, probe);
	const invalid = results.filter((result) => result.status !== "ok");

	return {
		verdict: invalid.length > 0 ? "invalid" : "verified",
		results,
		invalid,
	};
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure string building, kept here so they are testable)
// ---------------------------------------------------------------------------

export function describeInvalid(result: CitationResult): string {
	switch (result.status) {
		case "file-not-found":
			return `${result.raw} → 文件不存在`;
		case "line-out-of-range":
			return result.lineCount === undefined
				? `${result.raw} → 行号越界`
				: `${result.raw} → 文件仅 ${result.lineCount} 行，行号越界`;
		default:
			return result.raw;
	}
}

export function summarize(judgement: Judgement): string | undefined {
	switch (judgement.verdict) {
		case "verified":
			return `✓ ${judgement.results.length} 处引用已校验`;
		case "invalid":
			return `⚠️ ${judgement.invalid.length} 处引用无效`;
		case "no-citation":
			return "⚠️ 本轮回答未给出任何源码出处";
		default:
			return undefined;
	}
}
