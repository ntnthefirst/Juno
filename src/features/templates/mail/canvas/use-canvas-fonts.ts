import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MailFont } from "@shared/types";
import { messageOf } from "../../../../lib/errors";

/** Where a linked font stands, as the fonts panel says it. */
export type FontStatus =
	| { state: "loading" }
	| { state: "ready" }
	| { state: "failed"; message: string }
	/** A stylesheet link: the reader's client loads it, Juno does not. */
	| { state: "linked" };

export type CanvasFonts = {
	status: (font: MailFont) => FontStatus;
	/** Every face that has loaded, for the rendered preview's own document. */
	css: string;
	retry: (font: MailFont) => void;
};

type Loaded = { css: string } | { error: string };

/** One Google request: the family, and exactly the faces asked of it. */
function signature(font: MailFont): string {
	return `${font.family}|${font.weights.join(",")}|${font.italic ? "i" : ""}`;
}

function fromSignature(value: string): { family: string; weights: number[]; italic: boolean } {
	const [family = "", weights = "", italic = ""] = value.split("|");
	return {
		family,
		weights: weights.split(",").map((weight) => Number.parseInt(weight, 10)).filter(Number.isFinite),
		italic: italic === "i",
	};
}

const MARK = "data-juno-canvas-font";
const OWNER = "data-juno-canvas-font-owner";

/**
 * Puts the Google fonts a canvas names on the page, so a block set in one is
 * drawn in it.
 *
 * The main process fetches each family once and answers with the faces
 * inline (services/mail-fonts.ts); this puts them in a style element and
 * takes them away again when the font is removed or the editor closes. A
 * linked font is left alone: Juno does not fetch an address it was given, so
 * the canvas shows its fallback and the panel says why.
 */
export function useCanvasFonts(fonts: MailFont[]): CanvasFonts {
	// Each use owns the style elements it adds. The editor and a preview can
	// both load fonts, and neither may take away the other's.
	const owner = useId();
	const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
	const requested = useRef(new Set<string>());
	// Bumped by a retry, which is the one thing that asks again for a font
	// already asked for.
	const [attempt, setAttempt] = useState(0);
	const wanted = fonts
		.filter((font) => font.source === "google")
		.map(signature)
		.join("\n");

	useEffect(() => {
		for (const key of wanted.split("\n").filter(Boolean)) {
			if (requested.current.has(key)) continue;
			requested.current.add(key);
			window.juno.mail.templates
				.loadGoogleFont(fromSignature(key))
				.then((load) => setLoaded((current) => ({ ...current, [key]: { css: load.css } })))
				.catch((cause: unknown) => setLoaded((current) => ({ ...current, [key]: { error: messageOf(cause) } })));
		}
	}, [wanted, attempt]);

	// The faces on the page follow the fonts in the layout: one style element
	// each, removed as soon as the font is, and all of them when the editor
	// goes, so a family nobody is using does not linger in the window.
	useEffect(() => {
		const keys = new Set(wanted.split("\n").filter(Boolean));
		const mine = [...document.head.querySelectorAll(`style[${OWNER}="${CSS.escape(owner)}"]`)];
		for (const element of mine) {
			if (!keys.has(element.getAttribute(MARK) ?? "")) element.remove();
		}
		for (const key of keys) {
			const entry = loaded[key];
			if (!entry || !("css" in entry)) continue;
			if (mine.some((element) => element.isConnected && element.getAttribute(MARK) === key)) continue;
			const element = document.createElement("style");
			element.setAttribute(OWNER, owner);
			element.setAttribute(MARK, key);
			element.textContent = entry.css;
			document.head.append(element);
		}
	}, [wanted, loaded, owner]);

	useEffect(
		() => () => {
			for (const element of document.head.querySelectorAll(`style[${OWNER}="${CSS.escape(owner)}"]`)) {
				element.remove();
			}
		},
		[owner],
	);

	const status = useCallback(
		(font: MailFont): FontStatus => {
			if (font.source === "link") return { state: "linked" };
			const entry = loaded[signature(font)];
			if (!entry) return { state: "loading" };
			return "css" in entry ? { state: "ready" } : { state: "failed", message: entry.error };
		},
		[loaded],
	);

	const retry = useCallback((font: MailFont) => {
		const key = signature(font);
		requested.current.delete(key);
		setLoaded((current) => {
			const next = { ...current };
			delete next[key];
			return next;
		});
		setAttempt((current) => current + 1);
	}, []);

	const css = wanted
		.split("\n")
		.map((key) => loaded[key])
		.filter((entry): entry is { css: string } => Boolean(entry && "css" in entry))
		.map((entry) => entry.css)
		.join("\n");

	return { status, css, retry };
}
