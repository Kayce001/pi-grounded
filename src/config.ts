/**
 * All tunable constants live here. There is no config file by design
 * (PLAN D9) — pi loads extensions through jiti, so editing a constant and
 * running /reload is cheap enough that a JSON layer would not earn its keep.
 */

/** Built-in tools removed while grounded mode is on (PLAN D1). */
export const WRITE_TOOLS = ["edit", "write"] as const;

/**
 * Pi's full built-in tool set as of 0.85.1. Used only to warn when an
 * unfamiliar write-capable tool shows up, so the read-only claim stays honest.
 */
export const KNOWN_BUILTIN_TOOLS = [
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
] as const;

/**
 * Extensions whose `path:line` references we try to verify. A citation must
 * end in one of these plus a line number, which keeps things like `v1.2:30`
 * from being mistaken for a file reference (PLAN R2).
 */
export const CODE_EXTENSIONS = [
	"ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc",
	"md", "mdx", "py", "go", "rs", "java", "kt", "swift",
	"c", "h", "cc", "cpp", "hpp", "cs", "rb", "php",
	"sh", "bash", "ps1", "sql", "yaml", "yml", "toml", "ini",
	"vue", "svelte", "css", "scss", "html",
] as const;

/**
 * Assistant answers shorter than this are not checked at all. Stops "好的" and
 * other pleasantries from collecting a warning block (PLAN D5).
 */
export const MIN_ANSWER_LENGTH = 200;

/** Cap on how many references we verify per run, so a pathological answer cannot stall the turn. */
export const MAX_CITATIONS_PER_RUN = 100;

/** Longest file we will count lines in. Beyond this we accept the citation rather than block. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Labels the model is asked to use, and that we show back to the user (PLAN D7). */
export const LABELS = {
	inferred: "[推断]",
	unknown: "[不确定]",
} as const;

export const UI = {
	statusKey: "grounded",
	entryType: "grounded-note",
	statusOn: "🔍 grounded",
} as const;
