import type { ProjectsView } from "@shared/types";
import { Icon, type IconName } from "../../components/Icon";
import { MenuButton, type MenuItem } from "../../components/Menu";

type ViewControlsProps = {
	view: ProjectsView;
	onChange: (patch: Partial<ProjectsView>) => void;
};

const LAYOUTS: { id: ProjectsView["layout"]; label: string; icon: IconName }[] = [
	{ id: "grid", label: "Cards", icon: "grid" },
	{ id: "rows", label: "Rows", icon: "rows" },
	{ id: "list", label: "List", icon: "list" },
];

const SIZES: { id: ProjectsView["size"]; label: string }[] = [
	{ id: "small", label: "Small cards" },
	{ id: "medium", label: "Medium cards" },
	{ id: "large", label: "Large cards" },
];

const SORTS: { id: ProjectsView["sort"]; label: string }[] = [
	{ id: "recent", label: "Last touched" },
	{ id: "due", label: "Nearest deadline" },
	{ id: "name", label: "Name" },
	{ id: "client", label: "Client" },
];

/**
 * How the screen is drawn: three layouts, a card size, whether images appear at
 * all, and the order.
 *
 * The layout is a segmented control rather than a menu because it is the one
 * people change often and it should take one click. Everything else sits behind
 * the three dots, which is where "everything else you can do here" lives.
 *
 * Turning previews off is not a smaller card. It is the dense table with no
 * images anywhere, for the screen with two hundred projects on it and for
 * anyone who finds a wall of screenshots harder to read than a list of names.
 */
export function ViewControls({ view, onChange }: ViewControlsProps) {
	const items: MenuItem[] = [
		{
			id: "previews",
			label: view.previews ? "Hide previews" : "Show previews",
			icon: "image",
			onSelect: () => onChange({ previews: !view.previews }),
		},
		...SIZES.map((size) => ({
			id: `size-${size.id}`,
			label: size.label,
			icon: view.size === size.id ? ("check" as IconName) : undefined,
			disabled: view.layout !== "grid",
			separatorBefore: size.id === "small",
			onSelect: () => onChange({ size: size.id }),
		})),
		...SORTS.map((sort) => ({
			id: `sort-${sort.id}`,
			label: `Sort by ${sort.label.toLowerCase()}`,
			icon: view.sort === sort.id ? ("check" as IconName) : undefined,
			separatorBefore: sort.id === "recent",
			onSelect: () => onChange({ sort: sort.id }),
		})),
	];

	return (
		<div className="flex items-center gap-2">
			<div
				role="group"
				aria-label="Layout"
				className="flex items-center gap-px rounded-[var(--radius-md)] bg-[var(--sunken)] p-0.5"
			>
				{LAYOUTS.map((layout) => {
					const active = view.layout === layout.id;
					return (
						<button
							key={layout.id}
							type="button"
							aria-pressed={active}
							aria-label={layout.label}
							title={layout.label}
							onClick={() => onChange({ layout: layout.id })}
							className={[
								"flex h-[32px] w-[32px] items-center justify-center rounded-[var(--radius-sm)]",
								"transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]",
								active
									? "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-popover)]"
									: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
							].join(" ")}
						>
							<Icon name={layout.icon} />
						</button>
					);
				})}
			</div>

			<MenuButton items={items} ariaLabel="How this screen is shown" size="base" />
		</div>
	);
}
