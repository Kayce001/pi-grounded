import { describe, expect, it } from "vitest";

import {
	type FileProbe,
	describeInvalid,
	extractCitations,
	judge,
	summarize,
	verifyCitation,
} from "../src/citations.ts";

/**
 * Platform-independent fake. Deliberately does not use node:path so the same
 * expectations hold on Windows and POSIX.
 */
function makeProbe(files: Map<string, number | undefined>): FileProbe {
	const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/");
	return {
		resolve: (root, relative) => norm(`${root}/${relative}`),
		isAbsolute: (p) => p.startsWith("/") || /^[A-Za-z]:/.test(p),
		isFile: (p) => files.has(norm(p)),
		countLines: (p) => files.get(norm(p)),
	};
}

const ROOTS = ["/repo"];

describe("extractCitations — 正例", () => {
	const positives: Array<[string, string, number, number | undefined]> = [
		["src/a.ts:12", "src/a.ts", 12, undefined],
		["see packages/agent/src/harness.ts:120 for details", "packages/agent/src/harness.ts", 120, undefined],
		["`src/a.ts:7`", "src/a.ts", 7, undefined],
		["(src/a.ts:9)", "src/a.ts", 9, undefined],
		["[link](docs/readme.md:3)", "docs/readme.md", 3, undefined],
		["src/a.ts:10-20", "src/a.ts", 10, 20],
		["- src/a.ts:5", "src/a.ts", 5, undefined],
		["**src/a.ts:6**", "src/a.ts", 6, undefined],
		["定义在 src/deep/nested/file.tsx:44 处", "src/deep/nested/file.tsx", 44, undefined],
		["/usr/local/x/a.ts:3", "/usr/local/x/a.ts", 3, undefined],
		["C:\\Users\\x\\a.ts:3", "C:\\Users\\x\\a.ts", 3, undefined],
		["config.yaml:2", "config.yaml", 2, undefined],
		["scripts/build.sh:88", "scripts/build.sh", 88, undefined],
		["src\\win\\path.ts:15", "src\\win\\path.ts", 15, undefined],
	];

	for (const [text, path, line, endLine] of positives) {
		it(`匹配 ${JSON.stringify(text)}`, () => {
			const found = extractCitations(text);
			expect(found).toHaveLength(1);
			expect(found[0]?.path).toBe(path);
			expect(found[0]?.line).toBe(line);
			expect(found[0]?.endLine).toBe(endLine);
		});
	}

	it("同一引用出现两次只算一处", () => {
		expect(extractCitations("src/a.ts:12 和 src/a.ts:12")).toHaveLength(1);
	});

	it("同一文件不同行算两处", () => {
		expect(extractCitations("src/a.ts:12 和 src/a.ts:13")).toHaveLength(2);
	});

	it("一段话里的多处引用都能抓到", () => {
		const text = "先看 src/a.ts:1，再看 src/b.ts:2，最后 docs/c.md:3。";
		expect(extractCitations(text).map((c) => c.raw)).toEqual([
			"src/a.ts:1",
			"src/b.ts:2",
			"docs/c.md:3",
		]);
	});
});

describe("extractCitations — 反例（不得匹配）", () => {
	const negatives: Array<[string, string]> = [
		["裸文件名没有行号", "见 src/a.ts 这个文件"],
		["版本号不是路径", "升级到 v1.2:30 版本"],
		["纯数字点号", "1.2.3:45"],
		["URL 里的端口", "http://example.com/a.js:80"],
		["https URL", "https://cdn.example.com/lib/x.js:1"],
		["未知扩展名", "见 data.xyz:10"],
		["没有扩展名", "见 harness:120"],
		["时间不是引用", "会议在 12:30 开始"],
		["冒号后没有数字", "见 src/a.ts: 附近"],
		["扩展名后直接换行", "src/a.ts\n12"],
		["比例写法", "宽高比 16:9"],
	];

	for (const [name, text] of negatives) {
		it(name, () => {
			expect(extractCitations(text)).toHaveLength(0);
		});
	}
});

describe("verifyCitation", () => {
	it("路径存在且行号在范围内 → ok", () => {
		const probe = makeProbe(new Map([["/repo/src/a.ts", 100]]));
		const result = verifyCitation({ raw: "src/a.ts:50", path: "src/a.ts", line: 50 }, ROOTS, probe);
		expect(result.status).toBe("ok");
		expect(result.resolvedPath).toBe("/repo/src/a.ts");
	});

	it("行号正好等于总行数 → ok（边界）", () => {
		const probe = makeProbe(new Map([["/repo/src/a.ts", 100]]));
		const result = verifyCitation({ raw: "src/a.ts:100", path: "src/a.ts", line: 100 }, ROOTS, probe);
		expect(result.status).toBe("ok");
	});

	it("文件不存在 → file-not-found", () => {
		const probe = makeProbe(new Map());
		const result = verifyCitation({ raw: "src/a.ts:1", path: "src/a.ts", line: 1 }, ROOTS, probe);
		expect(result.status).toBe("file-not-found");
	});

	it("行号越界 → line-out-of-range，并带上真实行数", () => {
		const probe = makeProbe(new Map([["/repo/src/a.ts", 82]]));
		const result = verifyCitation({ raw: "src/a.ts:450", path: "src/a.ts", line: 450 }, ROOTS, probe);
		expect(result.status).toBe("line-out-of-range");
		expect(result.lineCount).toBe(82);
	});

	it("行号 0 → line-out-of-range（文件从 1 开始）", () => {
		const probe = makeProbe(new Map([["/repo/src/a.ts", 10]]));
		const result = verifyCitation({ raw: "src/a.ts:0", path: "src/a.ts", line: 0 }, ROOTS, probe);
		expect(result.status).toBe("line-out-of-range");
	});

	it("区间的结束行越界 → line-out-of-range", () => {
		const probe = makeProbe(new Map([["/repo/src/a.ts", 30]]));
		const result = verifyCitation(
			{ raw: "src/a.ts:10-40", path: "src/a.ts", line: 10, endLine: 40 },
			ROOTS,
			probe,
		);
		expect(result.status).toBe("line-out-of-range");
	});

	it("文件无法测量行数 → 判 ok，不制造误报", () => {
		const probe = makeProbe(new Map([["/repo/big.ts", undefined]]));
		const result = verifyCitation({ raw: "big.ts:999999", path: "big.ts", line: 999999 }, ROOTS, probe);
		expect(result.status).toBe("ok");
	});

	it("第一个根找不到时回退到第二个根", () => {
		const probe = makeProbe(new Map([["/gitroot/packages/a.ts", 50]]));
		const result = verifyCitation(
			{ raw: "packages/a.ts:10", path: "packages/a.ts", line: 10 },
			["/repo/sub", "/gitroot"],
			probe,
		);
		expect(result.status).toBe("ok");
		expect(result.resolvedPath).toBe("/gitroot/packages/a.ts");
	});

	it("绝对路径不走根目录拼接", () => {
		const probe = makeProbe(new Map([["/abs/a.ts", 5]]));
		const result = verifyCitation({ raw: "/abs/a.ts:2", path: "/abs/a.ts", line: 2 }, ROOTS, probe);
		expect(result.status).toBe("ok");
		expect(result.resolvedPath).toBe("/abs/a.ts");
	});
});

describe("judge", () => {
	const longText = "x".repeat(300);
	const probe = makeProbe(new Map([["/repo/src/a.ts", 100]]));

	it("模式关闭 → skipped", () => {
		const result = judge(longText, ROOTS, probe, { enabled: false });
		expect(result.verdict).toBe("skipped");
		expect(result.skipReason).toBe("disabled");
	});

	it("空回答 → skipped", () => {
		const result = judge("   ", ROOTS, probe, { enabled: true });
		expect(result.verdict).toBe("skipped");
		expect(result.skipReason).toBe("empty");
	});

	it("寒暄这种短回答 → skipped，不打扰", () => {
		const result = judge("好的", ROOTS, probe, { enabled: true });
		expect(result.verdict).toBe("skipped");
		expect(result.skipReason).toBe("too-short");
	});

	it("长回答但没有任何引用 → no-citation", () => {
		expect(judge(longText, ROOTS, probe, { enabled: true }).verdict).toBe("no-citation");
	});

	it("引用全部有效 → verified", () => {
		const result = judge(`${longText} 见 src/a.ts:50`, ROOTS, probe, { enabled: true });
		expect(result.verdict).toBe("verified");
		expect(result.results).toHaveLength(1);
		expect(result.invalid).toHaveLength(0);
	});

	it("只要有一处无效就判 invalid", () => {
		const result = judge(`${longText} 见 src/a.ts:50 和 src/a.ts:9999`, ROOTS, probe, {
			enabled: true,
		});
		expect(result.verdict).toBe("invalid");
		expect(result.invalid).toHaveLength(1);
		expect(result.results).toHaveLength(2);
	});

	it("minAnswerLength 可覆盖", () => {
		const result = judge("短的但有 src/a.ts:1", ROOTS, probe, {
			enabled: true,
			minAnswerLength: 5,
		});
		expect(result.verdict).toBe("verified");
	});
});

describe("提示文案", () => {
	it("文件不存在的说明", () => {
		expect(
			describeInvalid({ raw: "a.ts:1", path: "a.ts", line: 1, status: "file-not-found" }),
		).toContain("文件不存在");
	});

	it("越界时给出真实行数", () => {
		const text = describeInvalid({
			raw: "a.ts:450",
			path: "a.ts",
			line: 450,
			status: "line-out-of-range",
			lineCount: 182,
		});
		expect(text).toContain("182");
		expect(text).toContain("越界");
	});

	it("summarize 覆盖三种结论", () => {
		expect(summarize({ verdict: "verified", results: [{} as never], invalid: [] })).toContain("已校验");
		expect(summarize({ verdict: "invalid", results: [], invalid: [{} as never] })).toContain("无效");
		expect(summarize({ verdict: "no-citation", results: [], invalid: [] })).toContain("未给出");
		expect(summarize({ verdict: "skipped", results: [], invalid: [] })).toBeUndefined();
	});
});
