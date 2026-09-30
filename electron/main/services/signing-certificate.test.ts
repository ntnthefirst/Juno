import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCredentialStore, configureCredentialStore } from "./mail-credentials";
import * as certificate from "./signing-certificate";
import { makeP12 } from "./signing-fixtures";

describe("signing certificate", () => {
	beforeEach(() => configureCredentialStore(new MemoryCredentialStore()));

	it("reads the public part of a certificate", () => {
		const { info } = certificate.inspectP12(makeP12({ passphrase: "pw", commonName: "Nathan" }), "pw");
		expect(info.subject).toBe("Nathan, Juno Tests");
		expect(info.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it("refuses a wrong passphrase in plain words", () => {
		expect(() => certificate.inspectP12(makeP12({ passphrase: "pw" }), "nope")).toThrow(/passphrase was not accepted/);
	});

	it("refuses a file that is not a certificate", () => {
		expect(() => certificate.inspectP12(Buffer.from("hello"), "pw")).toThrow(/does not look like a certificate/);
	});

	it("refuses an expired certificate", () => {
		const p12 = makeP12({ passphrase: "pw", notBefore: new Date("2020-01-01"), notAfter: new Date("2021-01-01") });
		expect(() => certificate.inspectP12(p12, "pw")).toThrow(/expired on 2021-01-01/);
	});

	it("refuses a certificate that is not meant for signing", () => {
		const p12 = makeP12({ passphrase: "pw", digitalSignature: false });
		expect(() => certificate.inspectP12(p12, "pw")).toThrow(/not meant for signing/);
	});

	it("stores the file and the public part, and removes both", () => {
		const saved = certificate.save(makeP12({ passphrase: "pw" }), "pw");
		expect(certificate.get()?.fingerprint).toBe(saved.fingerprint);
		expect(certificate.readP12()).not.toBeNull();
		certificate.remove();
		expect(certificate.get()).toBeNull();
		expect(certificate.readP12()).toBeNull();
	});
});
