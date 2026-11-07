import { Icon, type IconName } from "../../components/Icon";
import { openNewRecord } from "../../lib/new-record";

type Step = {
	icon: IconName;
	title: string;
	description: string;
	onClick: () => void;
};

const STEPS: Step[] = [
	{
		icon: "clients",
		title: "Add your first client",
		description: "A record for the people you work for.",
		onClick: () => openNewRecord("client"),
	},
	{
		icon: "reminders",
		title: "Add a reminder",
		description: "Something that has to happen on a date.",
		onClick: () => openNewRecord("reminder"),
	},
	{
		icon: "mail",
		title: "Connect a mail account",
		description: "Mail stays on this machine.",
		onClick: () => void window.juno.window.openSettings("mail"),
	},
];

/** What the Overview offers while there is nothing in Juno yet. */
export function StartHere() {
	return (
		<section>
			<h2 className="text-h3">Start here</h2>
			<ul className="mt-3">
				{STEPS.map((step) => (
					<li key={step.title}>
						<button
							type="button"
							onClick={step.onClick}
							className="flex w-full items-center gap-3 border-b border-line py-4 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-hover"
						>
							<span className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] bg-hover text-ink-muted">
								<Icon name={step.icon} size={16} />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block text-base font-[var(--weight-medium)]">{step.title}</span>
								<span className="block text-sm text-ink-muted">{step.description}</span>
							</span>
							<Icon name="chevron-right" size={14} className="flex-none text-ink-muted" />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
