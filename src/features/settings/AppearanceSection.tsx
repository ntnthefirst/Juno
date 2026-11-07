import type { ThemeSetting } from "@shared/types";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Section } from "./Section";

type Option = { id: ThemeSetting; label: string; hint: string };

/**
 * Light first, then dark, then the one that is neither. System sits last
 * because it is the answer to a different question: not which of these, but
 * let the machine decide.
 */
const OPTIONS: Option[] = [
	{ id: "light", label: "Light", hint: "Always light" },
	{ id: "dark", label: "Dark", hint: "Always dark" },
	{ id: "system", label: "System", hint: "Follow the operating system" },
];

type AppearanceSectionProps = {
	theme: ThemeSetting;
	onChange: (next: ThemeSetting) => void;
	/** The line under the title. Setup says one more sentence than the settings page does. */
	description?: string;
};

export function AppearanceSection({
	theme,
	onChange,
	description = "System follows your operating system.",
}: AppearanceSectionProps) {
	return (
		<Section
			title="Appearance"
			anchor="appearance"
			description={description}
		>
			<div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-5 p-0.5">
				{OPTIONS.map((option) => (
					<ThemeCard
						key={option.id}
						option={option}
						selected={option.id === theme}
						onSelect={() => onChange(option.id)}
					/>
				))}
			</div>
		</Section>
	);
}

type ThemeCardProps = {
	option: Option;
	selected: boolean;
	onSelect: () => void;
};

function ThemeCard({ option, selected, onSelect }: ThemeCardProps) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			onClick={onSelect}
			title={option.hint}
			className="group flex w-full min-w-0 flex-col items-start gap-2 rounded-[var(--radius-md)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus)]"
		>
			<span
				aria-hidden
				className={[
					"block w-full overflow-hidden rounded-[var(--radius-lg)] transition-shadow duration-[var(--duration-fast)] ease-[var(--ease)]",
					selected
						? "shadow-[0_0_0_2px_var(--accent)]"
						: "shadow-[0_0_0_1px_var(--line-strong)] group-hover:shadow-[0_0_0_1px_var(--ink-faint)]",
				].join(" ")}
			>
				<Preview variant={option.id} />
			</span>

			<span className="flex items-center gap-1.5 px-0.5">
				{selected ? (
					<Icon name="check" size={14} className="flex-none text-[var(--accent)]" />
				) : null}
				<span
					className={[
						"text-dense",
						selected
							? "font-[var(--weight-medium)] text-[var(--accent)]"
							: "text-[var(--ink)]",
					].join(" ")}
				>
					{option.label}
				</span>
			</span>
		</button>
	);
}

/**
 * A miniature Juno: title bar, sidebar, rows. Drawn rather than screenshotted
 * so it stays right when the interface changes, and built from the swatch
 * tokens rather than the live ones, because the light card has to look light
 * while the application around it is dark.
 *
 * It fills the width of its grid column and keeps the proportions of the
 * 164 by 104 drawing it started as, so the three cards stay the same shape
 * in the settings window and in the smaller setup window.
 */
function Preview({ variant }: { variant: ThemeSetting }) {
	if (variant === "system") {
		// Split down the middle, which is the only honest picture of "whichever
		// the machine is using". Each half is the full window, clipped.
		return (
			<span className="relative block aspect-[180/113] w-full">
				<span className="absolute inset-0">
					<Window tone="light" />
				</span>
				<span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
					{/* Twice the half it sits in, which is the whole card. */}
					<span className="absolute inset-y-0 right-0 w-[200%]">
						<Window tone="dark" />
					</span>
				</span>
			</span>
		);
	}
	return (
		<span className="block aspect-[180/113] w-full">
			<Window tone={variant === "dark" ? "dark" : "light"} />
		</span>
	);
}

type Tone = "light" | "dark";

const TONES: Record<Tone, { paper: string; surface: string; line: string; mark: string; border: string }> = {
	light: {
		paper: "bg-[var(--swatch-light-paper)]",
		surface: "bg-[var(--swatch-light-surface)]",
		line: "bg-[var(--swatch-light-line)]",
		mark: "bg-[var(--swatch-light-mark)]",
		border: "border-[var(--swatch-light-line)]",
	},
	dark: {
		paper: "bg-[var(--swatch-dark-paper)]",
		surface: "bg-[var(--swatch-dark-surface)]",
		line: "bg-[var(--swatch-dark-line)]",
		mark: "bg-[var(--swatch-dark-mark)]",
		border: "border-[var(--swatch-dark-line)]",
	},
};

function Window({ tone }: { tone: Tone }) {
	const c = TONES[tone];
	return (
		<span className={`flex h-full w-full flex-col gap-[7px] p-[10px] ${c.paper}`}>
			<Bar className={c.line} width={26} />
			{[0, 1, 2, 3].map((row) => (
				<span
					key={row}
					className={`block h-[13px] flex-none rounded-[var(--radius-full)] border ${c.surface} ${c.border}`}
				/>
			))}
		</span>
	);
}

function Bar({ className, width }: { className: string; width: number }): ReactNode {
	return <span className={`block h-[3px] rounded-[var(--radius-full)] ${className}`} style={{ width }} />;
}
