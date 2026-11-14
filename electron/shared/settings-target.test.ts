import { describe, expect, it } from "vitest";
import { cleanSettingsTarget, settingsTargetFromQuery, settingsTargetQuery } from "./settings-target";

const ACCOUNT = "01a1bc02-27b2-7010-ac17-1bc6a06b7d44";

describe("settings targets", () => {
	it("keeps the two targets there are", () => {
		expect(cleanSettingsTarget({ kind: "add-calendar" })).toEqual({ kind: "add-calendar" });
		expect(cleanSettingsTarget({ kind: "new-rule", accountId: ACCOUNT })).toEqual({ kind: "new-rule", accountId: ACCOUNT });
	});

	it("refuses anything else", () => {
		expect(cleanSettingsTarget(null)).toBeNull();
		expect(cleanSettingsTarget("add-calendar")).toBeNull();
		expect(cleanSettingsTarget({ kind: "delete-everything" })).toBeNull();
		expect(cleanSettingsTarget({ kind: "new-rule" })).toBeNull();
		expect(cleanSettingsTarget({ kind: "new-rule", accountId: "../../etc" })).toBeNull();
		expect(cleanSettingsTarget({ kind: "new-rule", accountId: `${ACCOUNT}&open=x` })).toBeNull();
	});

	it("survives the trip through the address", () => {
		for (const target of [{ kind: "add-calendar" } as const, { kind: "new-rule", accountId: ACCOUNT } as const]) {
			expect(settingsTargetFromQuery(settingsTargetQuery(target))).toEqual(target);
		}
		expect(settingsTargetFromQuery("open=new-rule&account=nope")).toBeNull();
		expect(settingsTargetFromQuery("")).toBeNull();
	});
});
