/**
 * A code block as the canvas draws it.
 *
 * The same rule the compiler follows (`compileBlock` in
 * services/mail-layout.ts): one element gets the CSS as its own style, after
 * any it carries; anything more gets a div with the CSS around it. The saved
 * message is cleaned by the compiler's sanitiser. This is the draft, still
 * being typed, so it is cleaned here with the browser's own parser: nothing
 * that runs, no handler, no address that is not https, mailto, tel or a
 * placeholder. A picture at a web address is not fetched here either: it is
 * drawn as a box, the way the canvas draws one (remote-image.ts).
 */
import { cleanDeclarations } from "./box-style";
import { escapeAttribute, isDrawable, remotePlaceholder } from "./remote-image";

const DROPPED = "script,style,iframe,object,embed,form,svg,noscript,template,head,title,link,meta,base";

function safeAddress(value: string): boolean {
	return /^(https:|mailto:|tel:|\{\{)/i.test(value.trim());
}

export function codeMarkup(html: string, css: string): string {
	const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
	const body = parsed.body;
	for (const element of body.querySelectorAll(DROPPED)) element.remove();
	for (const element of body.querySelectorAll("*")) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			if (name.startsWith("on")) element.removeAttribute(attribute.name);
			else if ((name === "href" || name === "src") && !safeAddress(attribute.value)) element.removeAttribute(attribute.name);
			else if (name === "style") element.setAttribute("style", cleanDeclarations(attribute.value));
		}
	}

	for (const image of body.querySelectorAll("img")) {
		const src = image.getAttribute("src");
		if (src === null || isDrawable(src)) continue;
		const holder = parsed.createElement("template");
		holder.innerHTML = remotePlaceholder(image.getAttribute("alt") ?? "", escapeAttribute(image.getAttribute("style") ?? ""));
		image.replaceWith(holder.content);
	}

	const declarations = cleanDeclarations(css);
	const shown = [...body.childNodes].filter(
		(node) => node.nodeType === Node.ELEMENT_NODE || (node.textContent ?? "").trim() !== "",
	);
	const root = shown.length === 1 && shown[0] instanceof Element ? shown[0] : null;
	if (root) {
		const own = root.getAttribute("style");
		const merged = [own, declarations].filter(Boolean).join(";");
		if (merged) root.setAttribute("style", merged);
		return body.innerHTML;
	}
	const wrapper = parsed.createElement("div");
	if (declarations) wrapper.setAttribute("style", declarations);
	wrapper.append(...body.childNodes);
	return wrapper.outerHTML;
}
