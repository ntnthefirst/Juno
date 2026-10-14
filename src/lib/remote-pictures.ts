import { useCallback, useEffect, useSyncExternalStore } from "react";
import { messageOf } from "./errors";
import { remoteImageAddresses } from "./remote-image";

/**
 * Pictures at a web address that the person said can be loaded, held for the
 * editor and the previews to draw.
 *
 * Juno's window loads no image from the network, so a linked picture is a box
 * until someone confirms its source. Then the main process downloads it
 * (services/mail-pictures.ts) and the bytes are kept here, inline. The
 * confirmation is remembered per address in this browser profile, so the same
 * picture is fetched again when a template is opened without asking twice.
 * It is a convenience, not a record: clearing it only brings the box back.
 */

const TRUST_KEY = "juno.trustedPictures";

type Snapshot = Record<string, string>;

let loaded: Snapshot = {};
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function readTrusted(): Set<string> {
	try {
		const raw = window.localStorage.getItem(TRUST_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []);
	} catch {
		return new Set();
	}
}

function writeTrusted(addresses: Set<string>) {
	try {
		window.localStorage.setItem(TRUST_KEY, JSON.stringify([...addresses].slice(-500)));
	} catch {
		// Without storage the confirmation only lasts until the window closes.
	}
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Downloads one address and keeps the bytes. Throws the service's message. */
async function fetchPicture(address: string): Promise<void> {
	if (loaded[address] || inFlight.has(address)) return;
	inFlight.add(address);
	try {
		const result = await window.juno.mail.templates.loadPicture(address);
		loaded = { ...loaded, [address]: result.dataUrl };
		emit();
	} finally {
		inFlight.delete(address);
	}
}

export type RemotePictures = {
	/** Address to inline bytes, for every picture that has loaded. */
	pictures: Record<string, string>;
	/** Addresses in the message that are not drawn yet. */
	pending: string[];
	/** Called after the person confirmed the source. Resolves to an error message, or null. */
	confirm: () => Promise<string | null>;
};

/**
 * The state of the remote pictures a message names. Addresses the person
 * confirmed before load by themselves; the rest wait for `confirm`.
 */
export function useRemotePictures(html: string): RemotePictures {
	const pictures = useSyncExternalStore(subscribe, () => loaded);
	const key = remoteImageAddresses(html).join("\n");

	useEffect(() => {
		const trusted = readTrusted();
		for (const address of key ? key.split("\n") : []) {
			if (trusted.has(address)) void fetchPicture(address).catch(() => undefined);
		}
	}, [key]);

	const pending = (key ? key.split("\n") : []).filter((address) => !pictures[address]);

	const confirm = useCallback(async () => {
		const addresses = key ? key.split("\n") : [];
		const trusted = readTrusted();
		const failures: string[] = [];
		await Promise.all(
			addresses.map(async (address) => {
				try {
					await fetchPicture(address);
					trusted.add(address);
				} catch (cause: unknown) {
					failures.push(messageOf(cause));
				}
			}),
		);
		writeTrusted(trusted);
		return failures[0] ?? null;
	}, [key]);

	return { pictures, pending, confirm };
}

/** The same for one address, as the canvas needs it for a single image block. */
export function useRemotePicture(address: string): RemotePictures & { dataUrl: string | null } {
	const state = useRemotePictures(address ? `<img src="${address.replace(/"/g, "&quot;")}">` : "");
	return { ...state, dataUrl: state.pictures[address] ?? null };
}
