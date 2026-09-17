import type { ThemeSetting } from "@shared/types";

const THEMES: { id: ThemeSetting; label: string }[] = [
	{ id: "system", label: "System" },
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
];

export function TitleBar({
	theme,
	onThemeChange,
	lockConfigured,
}: {
	theme: ThemeSetting;
	onThemeChange: (next: ThemeSetting) => void;
	lockConfigured: boolean;
}) {
	return (
		<header
			className="drag-region flex flex-none items-center gap-3 border-b border-[var(--line)] px-4"
			style={{ height: "var(--titlebar-height)" }}
		>
			<svg viewBox="0 0 32 32" width="14" height="14" fill="none" aria-hidden className="opacity-80">
				<rect x="6" y="6" width="4" height="20" rx="1.5" fill="currentColor" />
				<rect x="11.5" y="6" width="12" height="9" rx="2.5" fill="currentColor" />
				<rect x="11.5" y="17" width="13.5" height="9" rx="2.5" fill="currentColor" />
			</svg>
			<span className="text-[length:var(--text-sm)] font-[var(--weight-medium)]">Bureau</span>

			<div className="flex-1" />

			<div
				className="no-drag flex gap-[2px] rounded-[var(--radius-md)] bg-[var(--sunken)] p-[2px]"
				role="group"
				aria-label="Theme"
			>
				{THEMES.map((option) => (
					<button
						key={option.id}
						type="button"
						aria-pressed={theme === option.id}
						onClick={() => onThemeChange(option.id)}
						className={[
							"rounded-[var(--radius-sm)] px-3 py-0.5 text-[length:var(--text-sm)] transition-colors",
							theme === option.id
								? "bg-[var(--surface)] font-[var(--weight-medium)] text-[var(--ink)]"
								: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
						].join(" ")}
					>
						{option.label}
					</button>
				))}
			</div>

			{lockConfigured ? (
				<button
					type="button"
					onClick={() => void window.bureau.lock.lock()}
					className="no-drag rounded-[var(--radius-md)] px-3 py-1 text-[length:var(--text-sm)] text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
				>
					Lock
				</button>
			) : null}
		</header>
	);
}
