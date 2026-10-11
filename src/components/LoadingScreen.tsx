import appIcon from "../assets/icon.png";

type LoadingScreenProps = {
	/** Optional message beneath the mark, defaults to none for a clean, calm splash. */
	message?: string;
};

/**
 * The initial window loading screen shown while lock state and database
 * services are initialising. Deliberately quiet: the Juno mark centered on
 * paper, with a gentle unshowy fade and breathing aura.
 */
export function LoadingScreen({ message }: LoadingScreenProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--paper)] transition-opacity duration-[var(--duration-fast)]"
			role="status"
			aria-label="Loading Juno"
		>
			<div className="flex flex-col items-center gap-3">
				<img
					src={appIcon}
					alt="Juno"
					className="h-16 w-16 object-contain transition-transform duration-[var(--duration-slow)] ease-[var(--ease)] [animation:juno-breathe_2.4s_ease-in-out_infinite] filter drop-shadow-[0_4px_20px_rgba(91,79,225,0.28)]"
				/>
				{message ? (
					<p className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
						{message}
					</p>
				) : null}
			</div>
		</div>
	);
}

/**
 * A compact inline loader with the Juno mark for panels or modals.
 */
export function LoadingMark({ size = 28 }: { size?: number }) {
	return (
		<div className="flex items-center justify-center p-4" role="status" aria-label="Loading">
			<img
				src={appIcon}
				alt=""
				style={{ width: size, height: size }}
				className="object-contain [animation:juno-breathe_2s_ease-in-out_infinite] opacity-80 filter drop-shadow-[0_2px_8px_rgba(91,79,225,0.2)]"
			/>
		</div>
	);
}
