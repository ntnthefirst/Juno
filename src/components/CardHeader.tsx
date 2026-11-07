import { AddButton } from "./AddButton";
import { Icon } from "./Icon";

type CardHeaderProps = {
	title: string;
	/** Drawn beside the title, muted. Left out when a count would only say "0". */
	count?: number;
	/** The screen the card links to: its name, and what pressing it does. */
	link?: { label: string; onClick: () => void };
	/** The plus that makes a new one, named for its tooltip. */
	add?: { label: string; onClick: () => void };
};

/**
 * The head of a card: a title, a count, the screen it links to and an optional
 * add (Card Header in the design file). 36px tall, so a card that carries one
 * lines up with the rows under it.
 */
export function CardHeader({ title, count, link, add }: CardHeaderProps) {
	return (
		<header className="flex h-9 items-center gap-2">
			<h2 className="text-lg font-[var(--weight-medium)]">{title}</h2>
			{count !== undefined && count > 0 ? (
				<span className="tabular-nums text-base text-ink-muted">{count}</span>
			) : null}
			<span className="min-w-px flex-1" />
			{link ? (
				<button
					type="button"
					onClick={link.onClick}
					className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-1 text-base text-ink-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:text-accent"
				>
					{link.label}
					<Icon name="chevron-right" size={12} />
				</button>
			) : null}
			{add ? <AddButton label={add.label} onClick={add.onClick} /> : null}
		</header>
	);
}
