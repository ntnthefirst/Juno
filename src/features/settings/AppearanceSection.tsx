import type { ThemeSetting } from "@shared/types";
import type { ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { Toggle } from "../../components/Toggle";
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
	/**
	 * The sidebar setting. Left out by setup, which asks about the theme and
	 * nothing else, so the checkbox only appears when both of these are given.
	 */
	sidebarAutoCollapse?: boolean | null;
	onSidebarAutoCollapseChange?: (next: boolean) => void;
};

export function AppearanceSection({
	theme,
	onChange,
	sidebarAutoCollapse,
	onSidebarAutoCollapseChange,
}: AppearanceSectionProps) {
	return (
		<Section
			title="Appearance"
			description="Three states rather than a switch, because following the operating system is a choice of its own."
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

			{onSidebarAutoCollapseChange && sidebarAutoCollapse !== undefined ? (
				<div className="mt-6">
					<Toggle
						checked={sidebarAutoCollapse ?? true}
						disabled={sidebarAutoCollapse === null}
						onChange={onSidebarAutoCollapseChange}
						label="Collapse the sidebar on its own"
						description="The sidebar goes back to icons when you choose something or click beside it."
					/>
				</div>
			) : null}
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
						"text-[length:var(--text-dense)]",
						selected
							? "font-[var(--weight-medium)] text-[var(--accent)]"
							: "text-[var(--ink-muted)]",
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
			<span className="relative block aspect-[164/104] w-full">
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
		<span className="block aspect-[164/104] w-full">
			<Window tone={variant === "dark" ? "dark" : "light"} />
		</span>
	);
}

type Tone = "light" | "dark";

const TONES: Record<Tone, { paper: string; surface: string; line: string; mark: string }> = {
	light: {
		paper: "bg-[var(--swatch-light-paper)]",
		surface: "bg-[var(--swatch-light-surface)]",
		line: "bg-[var(--swatch-light-line)]",
		mark: "bg-[var(--swatch-light-mark)]",
	},
	dark: {
		paper: "bg-[var(--swatch-dark-paper)]",
		surface: "bg-[var(--swatch-dark-surface)]",
		line: "bg-[var(--swatch-dark-line)]",
		mark: "bg-[var(--swatch-dark-mark)]",
	},
};

function Window({ tone }: { tone: Tone }) {
	const c = TONES[tone];
	return (
		<span className={`flex h-full w-full flex-col ${c.paper}`}>
			<span className={`flex h-[14px] flex-none items-center gap-1 px-2 ${c.surface}`}>
				<Bar className={c.mark} width={26} />
			</span>
			<span className={`h-px flex-none ${c.line}`} />
			<span className="flex min-h-0 flex-1">
				<span className={`flex w-[42px] flex-none flex-col gap-[5px] p-2 ${c.paper}`}>
					<Bar className={c.mark} width={20} />
					<Bar className={c.line} width={26} />
					<Bar className={c.line} width={22} />
					<Bar className={c.line} width={26} />
				</span>
				<span className={`flex min-w-0 flex-1 flex-col gap-[5px] p-2 ${c.paper}`}>
					{[0, 1, 2, 3].map((row) => (
						<span
							key={row}
							className={`flex h-[13px] flex-none items-center gap-1.5 rounded-[2px] px-1.5 ${c.surface}`}
						>
							<span className={`h-[5px] w-[5px] flex-none rounded-full ${c.mark}`} />
							<Bar className={c.line} width={row === 3 ? 34 : 52} />
						</span>
					))}
				</span>
			</span>
		</span>
	);
}

function Bar({ className, width }: { className: string; width: number }): ReactNode {
	return <span className={`block h-[3px] rounded-full ${className}`} style={{ width }} />;
}
