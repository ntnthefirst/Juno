import type { MailHeadingTag, MailTextTag } from "@shared/types";

/** The element a text is edited in: the one it is written as, bar the two that are not blocks. */
export type InlineTag = "div" | MailHeadingTag | "blockquote" | "pre" | "address" | "ul" | "ol";

/**
 * A paragraph is edited in a div, which is how it always has been, and so is
 * an inline span, which would otherwise be edited as a run of words with no
 * box to click in. Every other tag is edited as itself, so a quote keeps its
 * indent, a preformatted text its spacing and a list its bullets.
 */
export function editTag(tag: MailTextTag): InlineTag {
	return tag === "p" || tag === "span" ? "div" : tag;
}

/**
 * What a browser writes when text is edited in place, turned into the markup
 * a text block keeps.
 *
 * `contentEditable` is not neutral about markup. Chromium wraps every new line
 * in a `<div>`, writes a strikethrough as `<strike>`, and on a paste can leave
 * a `<font>` behind. None of those are in the set a text block keeps
 * (`sanitiseFragment` in services/mail-layout.ts), which escapes what it does
 * not keep into visible text rather than dropping it. So a line break typed on
 * the canvas would come back from a save as the letters `<div>`. This puts it
 * in the form the sanitiser keeps before it gets there.
 */
export function normaliseEditedHtml(html: string): string {
	return (
		html
			// An empty line is one break, not a div holding a break.
			.replace(/<div><br\s*\/?><\/div>/gi, "<br>")
			.replace(/<div[^>]*>/gi, "<br>")
			.replace(/<\/div>/gi, "")
			.replace(/<br\s*\/?>/gi, "<br>")
			.replace(/<strike>/gi, "<s>")
			.replace(/<\/strike>/gi, "</s>")
			.replace(/<\/?font[^>]*>/gi, "")
			.replace(/&nbsp;/g, " ")
			// A list item nobody typed in, left by the Enter that opened it.
			.replace(/<li>(?:<br>)?<\/li>/gi, "")
			// A break before the first line or after the last is the div the
			// browser opened and nobody typed into.
			.replace(/^(?:<br>)+/, "")
			.replace(/(?:<br>)+$/, "")
	);
}
