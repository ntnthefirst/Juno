import type { MailProvider } from "@shared/mail-providers";
import type { MailProviderId } from "@shared/types";
import { Icon, type IconName } from "../../../components/Icon";
import gmail from "../../../assets/providers/gmail.svg";
import icloud from "../../../assets/providers/icloud.svg";
import m365 from "../../../assets/providers/m365.svg";
import outlook from "../../../assets/providers/outlook.svg";
import ovh from "../../../assets/providers/ovh.svg";
import telenet from "../../../assets/providers/telenet.svg";
import yahoo from "../../../assets/providers/yahoo.svg";

type ProviderLogoProps = {
	/** Null draws `icon` on a sunken tile, or the first letter of `name`. */
	provider: MailProvider | null;
	/** For a host Juno knows without a tile, the letter comes from its name. */
	name?: string | null;
	icon?: IconName;
	/** 32 on a tile, as the frames draw it; 36 on a card. */
	size?: 32 | 36;
};

/**
 * The provider marks are other companies' logos, bundled as files with their
 * sources in `assets/providers/SOURCES.md`. They are the one sanctioned
 * exception to "never a raw colour" (styling.md section 2): a brand mark keeps
 * its own colours in both themes, so it is drawn as an image and never routed
 * through Icon.tsx or the tokens. Everything around it, the tile, its border
 * and the letter tiles, is tokens as usual.
 */
const LOGOS: Partial<Record<MailProviderId, string>> = {
	gmail,
	outlook,
	m365,
	icloud,
	ovh,
	telenet,
	yahoo,
};

/** Static strings, so Tailwind sees every class. */
const TONES = [
	"bg-tone-1",
	"bg-tone-2",
	"bg-tone-3",
	"bg-tone-4",
	"bg-tone-5",
	"bg-tone-6",
	"bg-tone-7",
	"bg-tone-8",
];

export function ProviderLogo({ provider, name, icon, size = 32 }: ProviderLogoProps) {
	const box = size === 36 ? "h-9 w-9" : "h-8 w-8";
	const logo = provider ? LOGOS[provider.id] : undefined;

	if (logo) {
		return (
			<span
				aria-hidden
				className={`flex ${box} flex-none items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]`}
			>
				<img src={logo} alt="" className="h-[22px] w-[22px] object-contain" draggable={false} />
			</span>
		);
	}

	if (!provider && (icon || !name)) {
		return (
			<span
				aria-hidden
				className={`flex ${box} flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--sunken)] text-[var(--ink)]`}
			>
				<Icon name={icon ?? "mail"} size={16} />
			</span>
		);
	}

	const letter = provider?.letter ?? Array.from(name ?? "?")[0]!.toUpperCase();
	const tone = TONES[((provider?.tone ?? 8) - 1) % TONES.length];
	return (
		<span
			aria-hidden
			className={`flex ${box} flex-none items-center justify-center rounded-[var(--radius-md)] text-base font-[var(--weight-semibold)] text-[var(--ink)] ${tone}`}
		>
			{letter}
		</span>
	);
}
