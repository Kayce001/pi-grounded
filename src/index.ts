/**
 * pi-grounded — ground Pi's answers in the codebase, not assumptions.
 *
 * Read-only research mode plus automatic verification of every `file:line`
 * reference the model produces. See PLAN.md for the design and VERIFY.md for
 * how to check that any of this actually works.
 *
 * This is the only module with side effects; the logic lives in citations.ts
 * and tools.ts so it can be tested without an LLM.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

import { UI } from "./config.ts";
import { type Judgement, describeInvalid, judge, summarize } from "./citations.ts";
import { createFileProbe } from "./probe.ts";
import { GROUNDED_BLOCK } from "./prompt.ts";
import { applyDisable, applyRestore, toolsToDisable, unknownTools } from "./tools.ts";

interface NoteData {
	verdict: Judgement["verdict"];
	summary: string;
	details: string[];
}

export default function grounded(pi: ExtensionAPI) {
	let enabled = false;
	/** Exactly what we removed, so we can put back only that (PLAN §5.2). */
	let disabledTools: string[] = [];
	/** Roots a relative citation is resolved against, in order. */
	let roots: string[] = [];
	/** Assistant text accumulated across the current run. */
	let runText = "";
	let lastJudgement: Judgement | undefined;
	const stats = { verified: 0, invalid: 0, noCitation: 0 };
	const lineCounts = new Map<string, number | undefined>();

	// -----------------------------------------------------------------------
	// Filesystem probe
	// -----------------------------------------------------------------------

	const probe = createFileProbe(lineCounts);

	async function resolveRoots(cwd: string): Promise<string[]> {
		const found = [cwd];
		try {
			const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000 });
			const top = result.stdout?.trim();
			if (result.code === 0 && top && top !== cwd) found.push(top);
		} catch {
			// Not a repo, or git missing. cwd alone is a fine answer.
		}
		return found;
	}

	// -----------------------------------------------------------------------
	// Mode switching
	// -----------------------------------------------------------------------

	function statusText(): string {
		if (!enabled) return "";
		const parts: string[] = [UI.statusOn];
		const summary = lastJudgement ? summarize(lastJudgement) : undefined;
		if (summary) parts.push(summary);
		return parts.join(" · ");
	}

	function refreshStatus(ctx: { ui: { setStatus: (k: string, v?: string) => void } }): void {
		ctx.ui.setStatus(UI.statusKey, enabled ? statusText() : undefined);
	}

	async function enable(ctx: any): Promise<string[]> {
		if (enabled) return [];
		enabled = true;
		lastJudgement = undefined;

		if (roots.length === 0) roots = await resolveRoots(ctx.cwd ?? process.cwd());

		const active = pi.getActiveTools();
		disabledTools = toolsToDisable(active);
		if (disabledTools.length > 0) pi.setActiveTools(applyDisable(active, disabledTools));

		refreshStatus(ctx);
		return disabledTools;
	}

	function disable(ctx: any): void {
		if (!enabled) return;
		enabled = false;

		if (disabledTools.length > 0) {
			pi.setActiveTools(applyRestore(pi.getActiveTools(), disabledTools));
			disabledTools = [];
		}

		lastJudgement = undefined;
		refreshStatus(ctx);
	}

	// -----------------------------------------------------------------------
	// Commands
	// -----------------------------------------------------------------------

	async function handleCommand(args: string, ctx: any): Promise<void> {
		const raw = args.trim();
		const arg = raw.toLowerCase();

		// `/grounded check <text>` runs the verifier over arbitrary text without
		// involving the model. It is how VERIFY.md checks the invalid-citation
		// path deterministically, and it is genuinely useful on its own for
		// checking references that came from somewhere else.
		if (arg.startsWith("check")) {
			const subject = raw.slice("check".length).trim();
			if (subject.length === 0) {
				ctx.ui.notify("用法: /grounded check <包含 file:line 的文本>", "info");
				return;
			}
			if (roots.length === 0) roots = await resolveRoots(ctx.cwd ?? process.cwd());
			lineCounts.clear();

			const result = judge(subject, roots, probe, { enabled: true, minAnswerLength: 0 });
			const lines = [summarize(result) ?? "无结论", ...result.invalid.map(describeInvalid)];
			if (result.verdict === "verified") {
				lines.push(...result.results.map((r) => `  ${r.raw} → ${r.resolvedPath}`));
			}
			ctx.ui.notify(lines.join("\n"), result.verdict === "invalid" ? "warning" : "info");
			return;
		}

		// Diagnostic: append a note straight from the command handler. If this
		// renders but the one from agent_settled does not, the problem is timing,
		// not the renderer.
		if (arg === "demo") {
			pi.appendEntry<NoteData>(UI.entryType, {
				verdict: "invalid",
				summary: "⚠️ 这是 /grounded demo 生成的测试块",
				details: ["demo/fake.ts:9999 → 文件不存在", "第二行明细"],
			});
			ctx.ui.notify("已 appendEntry。上方应出现一个提示块。", "info");
			return;
		}

		if (arg === "status") {
			const lines = [
				`grounded: ${enabled ? "on" : "off"}`,
				enabled && disabledTools.length > 0 ? `已禁用工具: ${disabledTools.join(", ")}` : "",
				`本会话统计 — 已校验 ${stats.verified} · 无效 ${stats.invalid} · 无出处 ${stats.noCitation}`,
				roots.length > 0 ? `解析根目录: ${roots.join(" | ")}` : "",
			].filter(Boolean);
			ctx.ui.notify(lines.join("\n"), "info");
			return;
		}

		const turnOn = arg === "on" ? true : arg === "off" ? false : !enabled;

		if (turnOn) {
			const removed = await enable(ctx);
			const unknown = unknownTools(pi.getAllTools().map((tool: any) => tool.name));
			const parts = ["grounded on · 只读模式"];
			if (removed.length > 0) parts.push(`已禁用工具: ${removed.join(", ")}`);
			if (unknown.length > 0) parts.push(`注意：存在非内置工具 ${unknown.join(", ")}，本插件不管控它们的写入行为`);
			ctx.ui.notify(parts.join("\n"), "info");
		} else {
			const restored = [...disabledTools];
			disable(ctx);
			ctx.ui.notify(
				restored.length > 0 ? `grounded off · 已恢复工具: ${restored.join(", ")}` : "grounded off",
				"info",
			);
		}
	}

	pi.registerCommand("grounded", {
		description: "只读研究模式：强制源码出处并自动校验 file:line",
		handler: handleCommand,
	});

	pi.registerCommand("source", {
		description: "/grounded 的别名",
		handler: handleCommand,
	});

	pi.registerFlag("grounded", {
		description: "Start in grounded (read-only, cited) mode",
		type: "boolean",
		default: false,
	});

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	pi.registerEntryRenderer<NoteData>(UI.entryType, (entry, state, theme) => {
		const data = entry.data ?? { verdict: "no-citation", summary: "", details: [] };
		const tone = data.verdict === "invalid" ? "error" : "warning";
		const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg(tone, data.summary), 0, 0));
		for (const detail of data.details) {
			box.addChild(new Text(theme.fg("dim", `  ${detail}`), 0, 0));
		}
		if (state?.expanded) {
			box.addChild(new Text(theme.fg("dim", "  /grounded status 查看本会话统计"), 0, 0));
		}
		return box;
	});

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag?.("grounded") === true && !enabled) {
			const removed = await enable(ctx);
			ctx.ui.notify(
				removed.length > 0
					? `grounded on · 只读模式（已禁用 ${removed.join(", ")}）`
					: "grounded on · 只读模式",
				"info",
			);
		}
		refreshStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return undefined;
		// New user prompt: start a fresh judgement window.
		runText = "";
		lastJudgement = undefined;
		lineCounts.clear();
		return { systemPrompt: event.systemPrompt + GROUNDED_BLOCK };
	});

	// Scan only — no side effects here. Appending an entry from message_end puts
	// it *before* the assistant message in the session (see NOTES.md §1.3).
	pi.on("message_end", async (event) => {
		if (!enabled) return;
		if (event.message?.role !== "assistant") return;
		const text = (event.message.content ?? [])
			.filter((part: any) => part?.type === "text" && typeof part.text === "string")
			.map((part: any) => part.text)
			.join("\n");
		if (text.length > 0) runText += (runText ? "\n" : "") + text;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled || runText.length === 0) return;

		try {
			if (roots.length === 0) roots = await resolveRoots(ctx.cwd ?? process.cwd());

			const judgement = judge(runText, roots, probe, { enabled: true });
			lastJudgement = judgement;

			if (judgement.verdict === "verified") stats.verified += 1;
			if (judgement.verdict === "invalid") stats.invalid += 1;
			if (judgement.verdict === "no-citation") stats.noCitation += 1;

			// A clean answer gets a footer tick and nothing else — no interruption.
			if (judgement.verdict === "invalid" || judgement.verdict === "no-citation") {
				pi.appendEntry<NoteData>(UI.entryType, {
					verdict: judgement.verdict,
					summary: summarize(judgement) ?? "",
					details: judgement.invalid.map(describeInvalid),
				});
			}

			refreshStatus(ctx);
		} catch (error) {
			// Never let verification break a session (PLAN T-2). Degrade silently.
			ctx.ui.setStatus(UI.statusKey, `${UI.statusOn} · 校验失败`);
			void error;
		} finally {
			runText = "";
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(UI.statusKey, undefined);
	});
}
