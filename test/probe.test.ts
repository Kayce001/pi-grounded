import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { judge, verifyCitation } from "../src/citations.ts";
import { countLinesIn, createFileProbe } from "../src/probe.ts";

let dir: string;

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-grounded-"));
	fs.writeFileSync(path.join(dir, "three.ts"), "a\nb\nc\n", "utf8");
	fs.writeFileSync(path.join(dir, "no-trailing.ts"), "a\nb\nc", "utf8");
	fs.writeFileSync(path.join(dir, "empty.ts"), "", "utf8");
	fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
	fs.writeFileSync(path.join(dir, "nested", "deep.ts"), "x\n".repeat(50), "utf8");
	fs.mkdirSync(path.join(dir, "adir.ts"), { recursive: true });
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("countLinesIn", () => {
	it("末尾换行不算新的一行", () => {
		expect(countLinesIn("a\nb\nc\n")).toBe(3);
	});

	it("末尾无换行", () => {
		expect(countLinesIn("a\nb\nc")).toBe(3);
	});

	it("空文件是 0 行", () => {
		expect(countLinesIn("")).toBe(0);
	});

	it("单行无换行", () => {
		expect(countLinesIn("only")).toBe(1);
	});

	it("只有一个换行符 = 1 行", () => {
		expect(countLinesIn("\n")).toBe(1);
	});
});

describe("createFileProbe — 真实文件系统", () => {
	it("能数出真实文件的行数", () => {
		const probe = createFileProbe();
		expect(probe.countLines(path.join(dir, "three.ts"))).toBe(3);
		expect(probe.countLines(path.join(dir, "no-trailing.ts"))).toBe(3);
		expect(probe.countLines(path.join(dir, "empty.ts"))).toBe(0);
		expect(probe.countLines(path.join(dir, "nested", "deep.ts"))).toBe(50);
	});

	it("目录不算文件", () => {
		const probe = createFileProbe();
		expect(probe.isFile(path.join(dir, "adir.ts"))).toBe(false);
		expect(probe.isFile(dir)).toBe(false);
	});

	it("不存在的路径不报错", () => {
		const probe = createFileProbe();
		expect(probe.isFile(path.join(dir, "nope.ts"))).toBe(false);
		expect(probe.countLines(path.join(dir, "nope.ts"))).toBeUndefined();
	});

	it("超过大小上限的文件不测量（返回 undefined 而不是判无效）", () => {
		const probe = createFileProbe(new Map(), 2); // 2 字节上限
		expect(probe.countLines(path.join(dir, "three.ts"))).toBeUndefined();
	});

	it("结果被缓存，重复调用不重复读盘", () => {
		const cache = new Map<string, number | undefined>();
		const probe = createFileProbe(cache);
		const target = path.join(dir, "three.ts");
		expect(probe.countLines(target)).toBe(3);
		expect(cache.get(target)).toBe(3);

		// 缓存命中后即使文件变了也返回旧值 —— 每轮 before_agent_start 会清缓存
		fs.writeFileSync(target, "a\nb\nc\nd\ne\n", "utf8");
		expect(probe.countLines(target)).toBe(3);
		expect(createFileProbe().countLines(target)).toBe(5);
		fs.writeFileSync(target, "a\nb\nc\n", "utf8");
	});

	it("Windows 与 POSIX 分隔符都能解析", () => {
		const probe = createFileProbe();
		expect(probe.isFile(probe.resolve(dir, "nested/deep.ts"))).toBe(true);
		expect(probe.isFile(probe.resolve(dir, "nested\\deep.ts"))).toBe(true);
	});
});

describe("端到端：真实文件上的判定", () => {
	it("有效行号 → ok", () => {
		const probe = createFileProbe();
		const result = verifyCitation(
			{ raw: "three.ts:2", path: "three.ts", line: 2 },
			[dir],
			probe,
		);
		expect(result.status).toBe("ok");
	});

	it("越界行号 → line-out-of-range，并报出真实行数", () => {
		const probe = createFileProbe();
		const result = verifyCitation(
			{ raw: "three.ts:9999", path: "three.ts", line: 9999 },
			[dir],
			probe,
		);
		expect(result.status).toBe("line-out-of-range");
		expect(result.lineCount).toBe(3);
	});

	it("不存在的文件 → file-not-found", () => {
		const probe = createFileProbe();
		const result = verifyCitation(
			{ raw: "ghost.ts:1", path: "ghost.ts", line: 1 },
			[dir],
			probe,
		);
		expect(result.status).toBe("file-not-found");
	});

	it("judge 在真实文件上给出 invalid", () => {
		const probe = createFileProbe();
		const text = `${"说明文字。".repeat(60)} 参见 three.ts:9999 以及 nested/deep.ts:10`;
		const result = judge(text, [dir], probe, { enabled: true });
		expect(result.verdict).toBe("invalid");
		expect(result.invalid).toHaveLength(1);
		expect(result.invalid[0]?.raw).toBe("three.ts:9999");
	});

	it("judge 在真实文件上给出 verified", () => {
		const probe = createFileProbe();
		const text = `${"说明文字。".repeat(60)} 参见 three.ts:2 以及 nested/deep.ts:10`;
		expect(judge(text, [dir], probe, { enabled: true }).verdict).toBe("verified");
	});
});
