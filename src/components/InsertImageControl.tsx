import { useRef, useState } from "react";
import { PhotoIcon } from "@heroicons/react/24/outline";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { TOOLBAR_BUTTON, TOOLBAR_BUTTON_ACTIVE } from "./toolbar-styles";

const MAX_LOCAL_IMAGE_BYTES = 2 * 1024 * 1024;

type InsertImageControlProps = {
	disabled?: boolean;
	/** The final `src`, either a https URL or a data: URL, ready for `insertImage`. */
	onInsert: (src: string) => void;
};

function megabytes(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Two ways to put an image in a message. A hosted https URL is the right
 * answer for mail: it keeps the message small and nothing about the
 * recipient leaks to load it. Embedding a local file is still offered,
 * because sometimes there is nowhere to host one, but it is never silent:
 * every embed asks first, with no remembered consent, per
 * docs/editors.md section 2.
 */
export function InsertImageControl({ disabled = false, onInsert }: InsertImageControlProps) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [urlError, setUrlError] = useState<string | null>(null);
	const [pendingFile, setPendingFile] = useState<File | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	function submitUrl() {
		const trimmed = url.trim();
		if (!trimmed) return;
		if (!/^https:\/\//i.test(trimmed)) {
			setUrlError(
				"Only a https address is accepted. A mail client that loads an image over plain http leaks the recipient's address and IP to anyone on the path.",
			);
			return;
		}
		onInsert(trimmed);
		setUrl("");
		setUrlError(null);
		setOpen(false);
	}

	function pickFile(file: File) {
		if (file.size > MAX_LOCAL_IMAGE_BYTES) {
			setFileError(`${file.name} is ${megabytes(file.size)} MB. Files over 2 MB are not embedded; use a hosted URL instead.`);
			if (fileInputRef.current) fileInputRef.current.value = "";
			return;
		}
		setFileError(null);
		setPendingFile(file);
	}

	function cancelFile() {
		setPendingFile(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	function confirmFile() {
		if (!pendingFile) return;
		const file = pendingFile;
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") onInsert(reader.result);
			setPendingFile(null);
			setOpen(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		};
		reader.readAsDataURL(file);
	}

	return (
		<div className="relative">
			<button
				type="button"
				disabled={disabled}
				aria-label="Insert an image"
				title="Insert an image"
				onClick={() => setOpen((value) => !value)}
				className={`${TOOLBAR_BUTTON}${open ? ` ${TOOLBAR_BUTTON_ACTIVE}` : ""}`}
			>
				<PhotoIcon width={16} height={16} strokeWidth={1.8} aria-hidden />
			</button>

			{open ? (
				<div
					className="absolute left-0 top-[calc(100%+4px)] z-10 w-[300px] rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-4"
					style={{ boxShadow: "var(--shadow-popover)" }}
				>
					<Field
						label="Image URL"
						value={url}
						onChange={(value) => {
							setUrl(value);
							setUrlError(null);
						}}
						placeholder="https://example.com/logo.png"
						error={urlError}
						help="A hosted address. This is the one a mail client actually loads."
					/>
					<div className="mt-2 flex justify-end">
						<Button size="dense" variant="primary" disabled={!url.trim()} onClick={submitUrl}>
							Insert
						</Button>
					</div>

					<div className="my-3 flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
						<span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
						or
						<span aria-hidden className="h-px flex-1 bg-[var(--line)]" />
					</div>

					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) pickFile(file);
						}}
					/>
					<Button size="dense" onClick={() => fileInputRef.current?.click()}>
						Embed a local file
					</Button>
					{fileError ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--risk)]">{fileError}</p> : null}
				</div>
			) : null}

			{pendingFile ? (
				<Dialog title="Embed this image" onClose={cancelFile} width="narrow">
					<p className="text-[var(--ink-muted)]">
						Embedding {pendingFile.name} makes the message bigger, and some mail clients refuse an
						embedded image outright. A hosted URL is the better answer when one is available.
					</p>
					<div className="mt-5 flex justify-end gap-2">
						<Button onClick={cancelFile}>Cancel</Button>
						<Button variant="primary" onClick={confirmFile}>
							Embed anyway
						</Button>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
