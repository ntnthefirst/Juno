/**
 * The name a document's file carries when it is dragged out of Juno, to the
 * desktop, Explorer or another app: its title and the extension of its newest
 * version, rather than the name Juno keeps it under. The window is handed
 * these names back, which is how it recognises its own drag coming back in.
 */

/** Characters Windows does not allow in a file name. */
const FORBIDDEN = /[<>:"/\\|?*]/g;

/** Control characters as spaces, which no file system wants in a name. */
function withoutControls(text: string): string {
	return Array.from(text, (char) => (char.charCodeAt(0) < 32 ? " " : char)).join("");
}

export function dragFileName(title: string, storedName: string | null): string {
	const dot = storedName ? storedName.lastIndexOf(".") : -1;
	const extension = storedName && dot > 0 ? storedName.slice(dot + 1).toLowerCase() : "";
	const base = withoutControls(title)
		.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 120) || "Document";
	return extension && !base.toLowerCase().endsWith(`.${extension}`) ? `${base}.${extension}` : base;
}

/** The names a drag of several documents carries: two with one title get "(2)", as Explorer would. */
export function dragFileNames(files: readonly { title: string; storedName: string | null }[]): string[] {
	const taken = new Set<string>();
	return files.map(({ title, storedName }) => {
		const wanted = dragFileName(title, storedName);
		const dot = wanted.lastIndexOf(".");
		const [stem, ending] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ""];
		let name = wanted;
		for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${stem} (${n})${ending}`;
		taken.add(name.toLowerCase());
		return name;
	});
}
