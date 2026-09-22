import { useEffect, useId, useRef, useState } from "react";
import type { AddressCandidate, LocationSuggestion } from "@shared/types";
import { messageOf } from "../../lib/errors";

type LocationFieldProps = {
	value: string;
	onChange: (value: string) => void;
};

const MIN_QUERY_LENGTH = 2;

const SOURCE_LABEL: Record<LocationSuggestion["source"], string> = {
	client: "Client",
	recent: "Used before",
};

const CONTROL =
	"w-full rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-3 py-2 text-[length:var(--text-base)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:bg-[var(--surface)]";

const OPTION =
	"flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-dense)] hover:bg-[var(--accent-soft)]";

/**
 * The event location. Suggestions come from two places, kept deliberately
 * different: matches from this database (a client's address, a place used
 * before) arrive as you type, because nothing leaves the machine to fetch
 * them. A real address lookup against OpenStreetMap only runs when the button
 * for it is pressed. Either way the field stays free text: "online", "at the
 * client's" or a location that resolves to nothing are all fine to save.
 */
export function LocationField({ value, onChange }: LocationFieldProps) {
	const id = useId();
	const containerRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [local, setLocal] = useState<LocationSuggestion[]>([]);
	const [online, setOnline] = useState<AddressCandidate[] | null>(null);
	const [lookingUp, setLookingUp] = useState(false);
	const [lookupNotice, setLookupNotice] = useState<string | null>(null);

	useEffect(() => {
		const query = value.trim();
		let cancelled = false;
		const timer = window.setTimeout(() => {
			if (query.length < MIN_QUERY_LENGTH) {
				if (!cancelled) setLocal([]);
				return;
			}
			window.juno.geocoding
				.suggestLocal(query)
				.then((rows) => {
					if (!cancelled) setLocal(rows);
				})
				.catch(() => {
					if (!cancelled) setLocal([]);
				});
		}, 150);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [value]);

	useEffect(() => {
		function onPointerDown(event: PointerEvent) {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
		}
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, []);

	/** Any change to the text invalidates whatever an earlier online lookup found. */
	function setText(text: string) {
		onChange(text);
		setOnline(null);
		setLookupNotice(null);
	}

	function choose(text: string) {
		setText(text);
		setOpen(false);
	}

	async function lookUpOnline() {
		const query = value.trim();
		if (query.length < MIN_QUERY_LENGTH || lookingUp) return;
		setLookingUp(true);
		setLookupNotice(null);
		try {
			const rows = await window.juno.geocoding.lookupAddress(query);
			setOnline(rows);
			setLookupNotice(rows.length === 0 ? "No address found for that text." : null);
		} catch (cause: unknown) {
			setOnline([]);
			setLookupNotice(messageOf(cause));
		} finally {
			setLookingUp(false);
		}
	}

	const query = value.trim();
	const showCard = open && query.length >= MIN_QUERY_LENGTH;

	return (
		<div ref={containerRef} className="relative">
			<label htmlFor={id} className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				Location
			</label>
			<input
				id={id}
				type="text"
				value={value}
				onFocus={() => setOpen(true)}
				onChange={(event) => {
					setText(event.target.value);
					setOpen(true);
				}}
				placeholder="An address, or wherever this actually happens"
				className={CONTROL}
				role="combobox"
				aria-expanded={showCard}
				aria-autocomplete="list"
			/>

			{showCard ? (
				<div
					className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[var(--shadow-popover)]"
					role="listbox"
				>
					{local.length > 0 ? (
						<ul className="flex flex-col">
							{local.map((suggestion, index) => (
								<li key={`local-${index}`}>
									<button type="button" role="option" onClick={() => choose(suggestion.address)} className={OPTION}>
										<span className="min-w-0 flex-1 truncate">{suggestion.address}</span>
										<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{SOURCE_LABEL[suggestion.source]}
										</span>
									</button>
								</li>
							))}
						</ul>
					) : null}

					{online && online.length > 0 ? (
						<>
							{local.length > 0 ? <div className="my-1 border-t border-[var(--line)]" /> : null}
							<ul className="flex flex-col">
								{online.map((candidate, index) => (
									<li key={`online-${index}`}>
										<button type="button" role="option" onClick={() => choose(candidate.label)} className={OPTION}>
											<span className="min-w-0 flex-1 truncate">{candidate.label}</span>
											<span className="shrink-0 text-[length:var(--text-micro)] text-[var(--ink-muted)]">Address</span>
										</button>
									</li>
								))}
							</ul>
						</>
					) : null}

					{local.length === 0 && (!online || online.length === 0) && !lookupNotice ? (
						<p className="px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">
							Nothing on file matches yet. Free text is fine too.
						</p>
					) : null}

					{lookupNotice ? (
						<p className="px-2 py-1.5 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{lookupNotice}</p>
					) : null}

					<div className="border-t border-[var(--line)] p-1">
						<button
							type="button"
							onClick={() => void lookUpOnline()}
							disabled={lookingUp}
							className="w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-dense)] text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
						>
							{lookingUp ? "Looking up" : `Look up "${query}" online`}
						</button>
						<p className="px-2 pb-1 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
							Asks OpenStreetMap for this address. The only step here that leaves this machine.
						</p>
					</div>
				</div>
			) : null}
		</div>
	);
}
