import { useEffect, useId, useRef, useState } from "react";
import type { MailAddress, MailRecipientSuggestion } from "@shared/types";
import { Icon } from "../../components/Icon";
import { displayName } from "./format";

type RecipientFieldProps = {
	label: string;
	value: MailAddress[];
	onChange: (next: MailAddress[]) => void;
	required?: boolean;
	autoFocus?: boolean;
	/** One sentence under the field. */
	help?: string;
};

/** Anything with an @ and a dot after it. The service validates properly. */
function looksLikeAddress(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** "Laura <laura@obet.be>" or a bare address, as typed or pasted. */
function parseTyped(text: string): MailAddress | null {
	const trimmed = text.trim().replace(/[,;]$/, "").trim();
	if (!trimmed) return null;
	const angled = /^(.*?)<([^<>]+)>$/.exec(trimmed);
	const address = (angled ? angled[2]! : trimmed).trim();
	if (!looksLikeAddress(address)) return null;
	const name = angled ? angled[1]!.trim().replace(/^"|"$/g, "") : "";
	return { name: name || null, address: address.toLowerCase() };
}

/**
 * Recipients as chips, with the address typed straight in.
 *
 * Nobody picks a client first. The address is what a person knows, and which
 * client it belongs to is what Juno works out, so what is typed here is matched
 * against client addresses, client contacts and mail already on this machine.
 * Enter commits one recipient, so does a comma, and an address nobody has ever
 * heard of is a perfectly good recipient too.
 */
export function RecipientField({
	label,
	value,
	onChange,
	required = false,
	autoFocus = false,
	help,
}: RecipientFieldProps) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [suggestions, setSuggestions] = useState<MailRecipientSuggestion[]>([]);
	const [active, setActive] = useState(0);

	const term = text.trim();

	// One character matches everything, so nothing is asked for until two. What
	// is shown is derived rather than cleared here: an effect that clears state
	// on its way in makes a second render for no reason.
	const shown = term.length >= 2 ? suggestions : [];

	useEffect(() => {
		if (term.length < 2) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			window.juno.mail.recipients
				.suggest(term)
				.then((rows) => {
					if (cancelled) return;
					setSuggestions(rows.filter((row) => !value.some((a) => a.address === row.address)));
					setActive(0);
				})
				.catch(() => undefined);
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [term, value]);

	function add(entry: MailAddress | null) {
		if (!entry) return;
		if (!value.some((a) => a.address === entry.address)) onChange([...value, entry]);
		setText("");
		setSuggestions([]);
	}

	function removeAt(index: number) {
		onChange(value.filter((_, i) => i !== index));
		input.current?.focus();
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "ArrowDown" && shown.length > 0) {
			event.preventDefault();
			setActive((current) => (current + 1) % shown.length);
			return;
		}
		if (event.key === "ArrowUp" && shown.length > 0) {
			event.preventDefault();
			setActive((current) => (current - 1 + shown.length) % shown.length);
			return;
		}
		if (event.key === "Enter" || event.key === "Tab" || event.key === "," || event.key === ";") {
			const chosen = shown[active];
			// Enter takes the highlighted suggestion when there is one, and what was
			// typed when there is not. Tab only commits something already typed, so
			// it still moves to the next field on an empty input.
			if (event.key === "Enter" && chosen) {
				event.preventDefault();
				add({ name: chosen.name, address: chosen.address });
				return;
			}
			const typed = parseTyped(text);
			if (typed) {
				event.preventDefault();
				add(typed);
			} else if (event.key === "," || event.key === ";") {
				event.preventDefault();
			}
			return;
		}
		if (event.key === "Backspace" && text === "" && value.length > 0) {
			event.preventDefault();
			removeAt(value.length - 1);
			return;
		}
		if (event.key === "Escape" && shown.length > 0) {
			event.preventDefault();
			setSuggestions([]);
		}
	}

	return (
		<div>
			<label htmlFor={id} className="mb-1 block text-[length:var(--text-sm)] text-[var(--ink-muted)]">
				{label}
				{required ? <span className="text-[var(--risk)]"> *</span> : null}
			</label>
			<div className="relative">
				<div
					// Clicking the padding around the chips lands in the input, which is
					// what the whole box looks like it does.
					onClick={() => input.current?.focus()}
					className="flex min-h-[40px] flex-wrap items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--sunken)] px-2 py-1 focus-within:border-[var(--accent)] focus-within:bg-[var(--surface)]"
				>
					{value.map((address, index) => (
						<span
							key={`${address.address}-${index}`}
							className="animate-pop inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] py-0.5 pr-1 pl-2 text-[length:var(--text-dense)] text-[var(--ink)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--accent-soft)]"
							title={address.address}
						>
							<span className="max-w-[24ch] truncate">{displayName(address)}</span>
							<button
								type="button"
								aria-label={`Remove ${address.address}`}
								onClick={() => removeAt(index)}
								className="inline-flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
							>
								<Icon name="close" size={10} />
							</button>
						</span>
					))}
					<input
						ref={input}
						id={id}
						type="text"
						value={text}
						autoFocus={autoFocus}
						autoComplete="off"
						spellCheck={false}
						role="combobox"
						aria-expanded={shown.length > 0}
						aria-autocomplete="list"
						onChange={(event) => setText(event.target.value)}
						onKeyDown={onKeyDown}
						// Leaving the field commits what is there, because a half-typed
						// address left behind reads as a recipient and is not one.
						onBlur={() => {
							const typed = parseTyped(text);
							if (typed) add(typed);
						}}
						placeholder={value.length === 0 ? "Name or email address" : ""}
						className="min-w-[16ch] flex-1 bg-transparent px-1 py-1 text-[length:var(--text-base)] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
					/>
				</div>

				{shown.length > 0 ? (
					<ul
						role="listbox"
						className="animate-pop absolute top-full right-0 left-0 z-20 mt-1 max-h-[280px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] py-1 shadow-[var(--shadow-popover)]"
					>
						{shown.map((suggestion, index) => (
							<li key={suggestion.address}>
								<button
									type="button"
									role="option"
									aria-selected={index === active}
									onMouseEnter={() => setActive(index)}
									onClick={() => add({ name: suggestion.name, address: suggestion.address })}
									className={[
										"flex w-full items-center gap-2 px-3 py-1.5 text-left",
										index === active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]",
									].join(" ")}
								>
									<Icon
										name={suggestion.source === "message" ? "mail" : "client"}
										size={14}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[length:var(--text-dense)]">
											{suggestion.name ?? suggestion.address}
										</span>
										<span className="block truncate text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{suggestion.address}
										</span>
									</span>
									{suggestion.clients.length > 0 ? (
										<span className="shrink-0 truncate rounded-[var(--radius-sm)] bg-[var(--sunken)] px-1.5 text-[length:var(--text-micro)] text-[var(--ink-muted)]">
											{suggestion.clients.map((client) => client.name).join(", ")}
										</span>
									) : null}
								</button>
							</li>
						))}
					</ul>
				) : null}
			</div>
			{help ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--ink-muted)]">{help}</p> : null}
		</div>
	);
}
