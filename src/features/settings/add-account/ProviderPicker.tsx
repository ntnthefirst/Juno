import { MAIL_PROVIDERS, type MailProvider } from "@shared/mail-providers";
import { microsoftSignInConfigured } from "@shared/oauth";
import type { MailProviderId } from "@shared/types";
import { Icon, type IconName } from "../../../components/Icon";
import { ProviderLogo } from "./ProviderLogo";

type ProviderPickerProps = {
	onPick: (provider: MailProviderId) => void;
	onOther: () => void;
	onByHand: () => void;
};

const TILE =
	"flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease)] hover:bg-[var(--hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:pointer-events-none disabled:opacity-60";

/** The first page of Add mail account: nine providers, any other address, or by hand. */
export function ProviderPicker({ onPick, onOther, onByHand }: ProviderPickerProps) {
	const microsoftReady = microsoftSignInConfigured();
	return (
		<div className="flex flex-col gap-4">
			<ul className="grid grid-cols-3 gap-2.5">
				{MAIL_PROVIDERS.map((provider) => {
					const unavailable = provider.signIn === "microsoft" && !microsoftReady;
					return (
						<li key={provider.id}>
							<ProviderTile provider={provider} unavailable={unavailable} onPick={() => onPick(provider.id)} />
						</li>
					);
				})}
			</ul>
			<div className="grid grid-cols-2 gap-2.5">
				<WideTile icon="mail" title="Other address" line="Juno looks up the servers" onClick={onOther} />
				<WideTile icon="terminal" title="Set up by hand" line="Fill in every server field" onClick={onByHand} />
			</div>
		</div>
	);
}

type ProviderTileProps = {
	provider: MailProvider;
	/** A Microsoft tile while this copy of Juno has no application ID. */
	unavailable: boolean;
	onPick: () => void;
};

function ProviderTile({ provider, unavailable, onPick }: ProviderTileProps) {
	return (
		<button
			type="button"
			data-provider={provider.id}
			disabled={unavailable}
			onClick={onPick}
			className={`${TILE} h-[60px] w-full pr-2.5 pl-3`}
		>
			<ProviderLogo provider={provider} />
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-base font-[var(--weight-medium)] text-[var(--ink)]">{provider.name}</span>
				<span className="truncate text-sm text-[var(--ink-muted)]">
					{unavailable ? "Sign-in not set up yet" : provider.line}
				</span>
			</span>
		</button>
	);
}

type WideTileProps = {
	icon: IconName;
	title: string;
	line: string;
	onClick: () => void;
};

function WideTile({ icon, title, line, onClick }: WideTileProps) {
	return (
		<button type="button" onClick={onClick} className={`${TILE} h-[60px] w-full px-3`}>
			<ProviderLogo provider={null} icon={icon} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-base font-[var(--weight-medium)] text-[var(--ink)]">{title}</span>
				<span className="truncate text-sm text-[var(--ink-muted)]">{line}</span>
			</span>
			<Icon name="chevron-right" size={14} className="flex-none text-[var(--ink)]" />
		</button>
	);
}
