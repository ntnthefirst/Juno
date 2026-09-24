import { useEffect, useRef } from "react";

type MessageEditorProps = {
	text: string;
	html: string | null;
	onChange: (text: string, html: string | null) => void;
};

function cleanHtml(value: string): string {
	const document = new DOMParser().parseFromString(value, "text/html");
	document.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
	document.querySelectorAll("*").forEach((node) => {
		for (const attribute of [...node.attributes]) {
			if (attribute.name.toLowerCase().startsWith("on")) node.removeAttribute(attribute.name);
		}
	});
	return document.body.innerHTML;
}

export default function MessageEditor({ text, html, onChange }: MessageEditorProps) {
	const editor = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!editor.current) return;
		const next = html ? cleanHtml(html) : text.replace(/\n/g, "<br>");
		if (editor.current.innerHTML !== next) editor.current.innerHTML = next;
	}, [html, text]);

	function update() {
		if (!editor.current) return;
		const nextHtml = cleanHtml(editor.current.innerHTML);
		onChange(editor.current.innerText, nextHtml || null);
	}

	function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
		const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
		if (!image) return;
		event.preventDefault();
		const file = image.getAsFile();
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			document.execCommand("insertImage", false, String(reader.result));
			update();
		};
		reader.readAsDataURL(file);
	}

	return (
		<div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-popover)] focus-within:border-[var(--accent)]">
			<div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--accent)]">
				<span
					className="h-2 w-2 rounded-full bg-[var(--accent)]"
					aria-hidden="true"
				/>
				<span>Plain email</span>
				<span className="ml-auto text-[var(--ink-muted)]">
					Images and formatting are kept in the HTML copy.
				</span>
			</div>
			<div
				ref={editor}
				contentEditable
				role="textbox"
				aria-label="Message"
				aria-multiline="true"
				onInput={update}
				onPaste={handlePaste}
				data-placeholder="Write your message"
				className="min-h-[280px] px-4 py-4 text-[length:var(--text-lg)] leading-[var(--leading-relaxed)] text-[var(--ink)] outline-none empty:before:text-[var(--ink-faint)] empty:before:content-[attr(data-placeholder)] [&_img]:max-w-full [&_img]:rounded-[var(--radius-md)]"
			/>
		</div>
	);
}
