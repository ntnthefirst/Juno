import { useState } from "react";
import type { MailFont, MailFontFallback } from "@shared/types";
import { Button } from "../../../../components/Button";
import {
	PanelButton,
	PanelCheckbox,
	PanelNote,
	PanelSection,
	Segmented,
	TextInput,
} from "./panel-controls";
import type { FontStatus } from "./use-canvas-fonts";

type FontsSectionProps = {
	fonts: MailFont[];
	onChange: (fonts: MailFont[]) => void;
	status: (font: MailFont) => FontStatus;
	onRetry: (font: MailFont) => void;
};

/** Matches MAX_FONTS in services/mail-layout.ts. */
const MAX_FONTS = 6;

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const FALLBACK_OPTIONS: { value: MailFontFallback; label: string; title: string }[] = [
	{ value: "sans", label: "Sans", title: "Falls back to Arial" },
	{ value: "serif", label: "Serif", title: "Falls back to Georgia" },
	{ value: "mono", label: "Mono", title: "Falls back to Courier New" },
];

/** Matches toFamily in services/mail-layout.ts. */
function cleanFamily(value: string): string | null {
	const trimmed = value.trim().replace(/\s+/g, " ");
	return /^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$/.test(trimmed) ? trimmed : null;
}

/** Matches safeStylesheetHref: an https stylesheet that cannot leave its attribute. */
function cleanHref(value: string): string | null {
	const trimmed = value.trim();
	return /^https:\/\/[^\s"'<>()\\]+$/i.test(trimmed) && trimmed.length <= 500 ? trimmed : null;
}

type StatusLineProps = {
	font: MailFont;
	status: FontStatus;
	onRetry: () => void;
};

function StatusLine({ font, status, onRetry }: StatusLineProps) {
	switch (status.state) {
		case "loading":
			return <PanelNote>Loading from Google Fonts.</PanelNote>;
		case "ready":
			return <PanelNote>Shown on the canvas. Linked in the message.</PanelNote>;
		case "linked":
			return (
				<PanelNote>
					{font.href
						? "Linked in the message. Juno does not load an address it was given, so the canvas shows the fallback."
						: "That address is not an https stylesheet, so nothing is linked. Correct it below."}
				</PanelNote>
			);
		case "failed":
			return (
				<div className="flex items-start gap-2">
					<p className="flex-1 border-l-2 border-[var(--risk)] pl-2 text-[length:var(--text-micro)] leading-[var(--leading-normal)] text-[var(--risk)]">
						{status.message}
					</p>
					<Button size="dense" onClick={onRetry}>
						Retry
					</Button>
				</div>
			);
	}
}

/**
 * The typefaces the message links.
 *
 * A Google font is named, and Juno builds its address and loads it once so
 * the canvas can draw with it. Anything else, a font from Adobe, Bunny,
 * Fontshare or a server of the business's own, is a stylesheet link: the
 * reader's client loads it and Juno never does, so the canvas shows its
 * fallback. Either way the fallback is what Gmail and Outlook on Windows show,
 * because neither loads a web font at all, and that is why every font has to
 * name one.
 */
export function FontsSection({ fonts, onChange, status, onRetry }: FontsSectionProps) {
	const [adding, setAdding] = useState(false);
	const [source, setSource] = useState<MailFont["source"]>("google");
	const [family, setFamily] = useState("");
	const [href, setHref] = useState("https://");
	const [fallback, setFallback] = useState<MailFontFallback>("sans");
	const [open, setOpen] = useState<string | null>(null);

	const clean = cleanFamily(family);
	const duplicate = clean !== null && fonts.some((font) => font.family.toLowerCase() === clean.toLowerCase());
	const linkReady = source === "google" || cleanHref(href) !== null;
	const canAdd = clean !== null && !duplicate && linkReady && fonts.length < MAX_FONTS;

	function add(): void {
		if (!canAdd || !clean) return;
		onChange([
			...fonts,
			{
				family: clean,
				source,
				href: source === "link" ? cleanHref(href) : null,
				weights: [400, 700],
				italic: false,
				fallback,
			},
		]);
		setFamily("");
		setHref("https://");
		setAdding(false);
		setOpen(clean);
	}

	function patch(target: string, change: Partial<MailFont>): void {
		onChange(fonts.map((font) => (font.family === target ? { ...font, ...change } : font)));
	}

	return (
		<PanelSection
			title="Fonts"
			action={
				<PanelButton
					label={adding ? "Stop adding a font" : "Add a font"}
					icon={adding ? "close" : "add"}
					disabled={!adding && fonts.length >= MAX_FONTS}
					onClick={() => setAdding((current) => !current)}
				/>
			}
		>
			{adding ? (
				<div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2">
					<Segmented
						label="Where the font comes from"
						value={source}
						options={[
							{ value: "google", label: "Google Fonts" },
							{ value: "link", label: "Stylesheet link" },
						]}
						onChange={setSource}
					/>
					<TextInput
						label="Family name"
						value={family}
						placeholder={source === "google" ? "Playfair Display" : "The family the stylesheet declares"}
						onChange={setFamily}
						onEnter={add}
					/>
					{source === "link" ? (
						<TextInput label="Stylesheet address" type="url" value={href} placeholder="https://" onChange={setHref} />
					) : null}
					<Segmented label="Fallback" value={fallback} options={FALLBACK_OPTIONS} onChange={setFallback} />
					{family && !clean ? (
						<PanelNote tone="warn">Letters, digits, spaces and hyphens only, the way the family is written.</PanelNote>
					) : duplicate ? (
						<PanelNote tone="warn">{clean} is already linked.</PanelNote>
					) : source === "link" && href !== "https://" && !linkReady ? (
						<PanelNote tone="warn">The address has to be an https stylesheet.</PanelNote>
					) : (
						<PanelNote>
							{source === "google"
								? "Written the way fonts.google.com writes it. Regular and bold to start with."
								: "Adobe, Bunny, Fontshare or your own server. Juno links it and does not load it."}
						</PanelNote>
					)}
					<Button size="dense" variant="primary" disabled={!canAdd} onClick={add}>
						Add font
					</Button>
				</div>
			) : null}

			{fonts.length === 0 && !adding ? (
				<PanelNote>
					No linked fonts. The message is set in its own font and in the families every mail client has.
				</PanelNote>
			) : null}

			{fonts.map((font) => {
				const expanded = open === font.family;
				const fontStatus = status(font);
				return (
					<div key={font.family} className="rounded-[var(--radius-sm)] border border-[var(--line)]">
						<div className="flex items-center gap-1 pl-2">
							<button
								type="button"
								aria-expanded={expanded}
								onClick={() => setOpen(expanded ? null : font.family)}
								className="flex h-[28px] min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
							>
								<span
									className="truncate text-[length:var(--text-sm)] text-[var(--ink)]"
									style={fontStatus.state === "ready" ? { fontFamily: `'${font.family}'` } : undefined}
								>
									{font.family}
								</span>
								<span className="flex-none text-[length:var(--text-micro)] text-[var(--ink-muted)]">
									{font.source === "google" ? "Google" : "Link"}
								</span>
							</button>
							<PanelButton
								label={`Remove ${font.family}`}
								icon="remove"
								tone="danger"
								onClick={() => onChange(fonts.filter((other) => other.family !== font.family))}
							/>
						</div>
						<div className="px-2 pb-2">
							<StatusLine font={font} status={fontStatus} onRetry={() => onRetry(font)} />
						</div>
						{expanded ? (
							<div className="flex flex-col gap-2 border-t border-[var(--line)] p-2">
								{font.source === "google" ? (
									<>
										<div role="group" aria-label="Weights" className="flex flex-wrap gap-1">
											{WEIGHTS.map((weight) => {
												const on = font.weights.includes(weight);
												return (
													<button
														key={weight}
														type="button"
														aria-pressed={on}
														title={on ? `Stop asking for ${weight}` : `Ask for ${weight} too`}
														disabled={on && font.weights.length === 1}
														onClick={() =>
															patch(font.family, {
																weights: on
																	? font.weights.filter((other) => other !== weight)
																	: [...font.weights, weight].sort((a, b) => a - b),
															})
														}
														className={`tabular h-[26px] min-w-[36px] rounded-[var(--radius-sm)] px-1 text-[length:var(--text-micro)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] disabled:opacity-60 ${
															on
																? "bg-[var(--accent-soft)] text-[var(--accent)]"
																: "bg-[var(--sunken)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
														}`}
													>
														{weight}
													</button>
												);
											})}
										</div>
										<PanelCheckbox
											label="Italics too"
											checked={font.italic}
											onChange={(italic) => patch(font.family, { italic })}
										/>
										<PanelNote>
											Every weight is a file the reader's client downloads. Ask for the ones the
											message uses.
										</PanelNote>
									</>
								) : (
									<TextInput
										label="Stylesheet address"
										type="url"
										value={font.href ?? ""}
										placeholder="https://"
										onChange={(next) => patch(font.family, { href: cleanHref(next) ?? next })}
									/>
								)}
								<Segmented
									label="Fallback"
									value={font.fallback}
									options={FALLBACK_OPTIONS}
									onChange={(next) => patch(font.family, { fallback: next })}
								/>
							</div>
						) : null}
					</div>
				);
			})}

			{fonts.length > 0 ? (
				<PanelNote>
					Gmail and Outlook on Windows load no web fonts at all and show each font's fallback.
				</PanelNote>
			) : null}
		</PanelSection>
	);
}
