import type { ThemeSetting } from "@shared/types";
import { Section } from "./Section";

const OPTIONS: { id: ThemeSetting; label: string; hint: string }[] = [
	{ id: "system", label: "System", hint: "Follow the operating system" },
	{ id: "light", label: "Light", hint: "Always light" },
	{ id: "dark", label: "Dark", hint: "Always dark" },
];

export function AppearanceSection({
	theme,
	onChange,
}: {
	theme: ThemeSetting;
	onChange: (next: ThemeSetting) => void;
}) {
	return (
		<Section
			title="Appearance"
			description="Three states rather than a switch, because following the operating system is a choice of its own."
		>
			<div role="radiogroup" aria-label="Theme" className="flex flex-col gap-1">
				{OPTIONS.map((option) => {
					const active = option.id === theme;
					return (
						<button
							key={option.id}
							type="button"
							role="radio"
							aria-checked={active}
							onClick={() => onChange(option.id)}
							className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] ${
								active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"
							}`}
						>
							<span
								aria-hidden
								className={`h-[14px] w-[14px] shrink-0 rounded-full border-2 ${
									active
										? "border-[var(--accent)] bg-[var(--accent)]"
										: "border-[var(--line-strong)]"
								}`}
							/>
							<span
								className={active ? "font-[var(--weight-medium)] text-[var(--accent)]" : undefined}
							>
								{option.label}
							</span>
							<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">
								{option.hint}
							</span>
						</button>
					);
				})}
			</div>
		</Section>
	);
}
