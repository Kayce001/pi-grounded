import { describe, expect, it } from "vitest";

import { applyDisable, applyRestore, toolsToDisable, unknownTools } from "../src/tools.ts";

const FULL = ["read", "bash", "edit", "write", "grep", "find", "ls"];

describe("toolsToDisable", () => {
	it("只挑出写工具", () => {
		expect(toolsToDisable(FULL)).toEqual(["edit", "write"]);
	});

	it("写工具本来就不在时返回空", () => {
		expect(toolsToDisable(["read", "grep"])).toEqual([]);
	});

	it("只有一个写工具时也正确", () => {
		expect(toolsToDisable(["read", "write"])).toEqual(["write"]);
	});
});

describe("applyDisable", () => {
	it("移除后其余顺序不变", () => {
		expect(applyDisable(FULL, ["edit", "write"])).toEqual(["read", "bash", "grep", "find", "ls"]);
	});
});

describe("applyRestore", () => {
	it("把摘掉的加回来", () => {
		const disabled = toolsToDisable(FULL);
		const off = applyDisable(FULL, disabled);
		expect(applyRestore(off, disabled).sort()).toEqual([...FULL].sort());
	});

	it("不覆盖用户中途关掉的其它工具", () => {
		// 开启 grounded → 摘掉 edit/write
		const disabled = toolsToDisable(FULL);
		const off = applyDisable(FULL, disabled);
		// 用户手动关掉 find
		const userTurnedOffFind = off.filter((t) => t !== "find");
		// 关闭 grounded
		const restored = applyRestore(userTurnedOffFind, disabled);

		expect(restored).toContain("edit");
		expect(restored).toContain("write");
		expect(restored).not.toContain("find"); // 用户的改动被保留
	});

	it("不覆盖用户中途新开的工具", () => {
		const disabled = ["edit", "write"];
		const current = ["read", "bash", "powershell"];
		expect(applyRestore(current, disabled)).toEqual(["read", "bash", "powershell", "edit", "write"]);
	});

	it("重复调用是幂等的", () => {
		const once = applyRestore(["read"], ["edit"]);
		expect(applyRestore(once, ["edit"])).toEqual(once);
	});

	it("没摘过任何工具时不改变现状", () => {
		expect(applyRestore(["read", "bash"], [])).toEqual(["read", "bash"]);
	});
});

describe("unknownTools", () => {
	it("识别出非内置工具", () => {
		expect(unknownTools([...FULL, "my_custom_tool"])).toEqual(["my_custom_tool"]);
	});

	it("全是内置工具时为空", () => {
		expect(unknownTools(FULL)).toEqual([]);
	});
});
