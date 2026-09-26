import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { messageOf } from "../../lib/errors";
import { Section, SectionError } from "./Section";

type Load =
	| { status: "loading" }
	| { status: "ready"; path: string | null; image: string | null };

/**
 * The image arrives as a data URL from the main process rather than as a path.
 * The renderer's CSP allows `data:` and not `file:`, and widening it to `file:`
 * would let any bug in the renderer read arbitrary local images.
 */
async function readSignature(): Promise<{ path: string | null; image: string | null }> {
	const [path, image] = await Promise.all([
		window.juno.settings.getSignaturePath(),
		window.juno.settings.getSignatureImage(),
	]);
	return { path, image };
}

export function SignatureSection() {
	const [load, setLoad] = useState<Load>({ status: "loading" });
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		readSignature()
			.then(({ path, image }) => {
				if (!cancelled) setLoad({ status: "ready", path, image });
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(messageOf(cause));
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function refresh() {
		setLoad({ status: "ready", ...(await readSignature()) });
	}

	async function choose() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.chooseSignature();
			await refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await window.juno.settings.clearSignature();
			await refresh();
		} catch (cause: unknown) {
			setError(messageOf(cause));
		} finally {
			setBusy(false);
		}
	}

	const path = load.status === "ready" ? load.path : null;
	const image = load.status === "ready" ? load.image : null;

	return (
		<Section
			title="Signature"
			description="Stamped onto a PDF when you sign it. Optional."
			action={
				<div className="flex gap-1">
					<Button size="dense" disabled={busy} onClick={() => void choose()}>
						Choose image
					</Button>
					{path === null ? null : (
						<Button size="dense" variant="danger" disabled={busy} onClick={() => void remove()}>
							Remove
						</Button>
					)}
				</div>
			}
		>
			{load.status === "loading" ? (
				<p className="text-[var(--ink-muted)]">Loading.</p>
			) : path === null ? (
				<p className="text-[length:var(--text-dense)] text-[var(--ink-muted)]">
					No image set. A transparent PNG works best.
				</p>
			) : (
				<div>
					{image ? (
						<img
							src={image}
							alt="Your signature"
							className="max-h-[96px] max-w-[320px] rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-2"
						/>
					) : null}
					<p
						data-selectable
						className="mt-2 break-all text-[length:var(--text-sm)] text-[var(--ink-muted)]"
					>
						{path}
					</p>
				</div>
			)}

			<SectionError message={error} />
		</Section>
	);
}
