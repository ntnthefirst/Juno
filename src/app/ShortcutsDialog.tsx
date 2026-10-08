import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Kbd } from "../components/Kbd";
import { SHORTCUT_GROUPS, formatCombo } from "../lib/shortcuts";

type ShortcutsDialogProps = {
	onClose: () => void;
};

/**
 * Every shortcut on one sheet. It is a dialog and not a page because it is a
 * question with one answer: what was that key. Escape closes it, which the
 * dialog already does, and so does the button for a pointer.
 */
export function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
	return (
		<Dialog title="Keyboard shortcuts" onClose={onClose}>
			<div className="mt-5 flex flex-col gap-6">
				{SHORTCUT_GROUPS.map((group) => (
					<section key={group.title}>
						<h3 className="mb-1 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--ink-muted)]">
							{group.title}
						</h3>
						<ul>
							{group.rows.map((row) => (
								<li
									key={row.label}
									className="flex min-h-[36px] items-center justify-between gap-6 border-b border-[var(--line)]/60 last:border-b-0"
								>
									<span className="text-[length:var(--text-base)]">{row.label}</span>
									<span className="flex items-center gap-2">
										{row.combos.map((combo, index) => (
											<span key={combo} className="flex items-center gap-2">
												{index > 0 ? (
													<span className="text-[length:var(--text-sm)] text-[var(--ink-muted)]">or</span>
												) : null}
												<Kbd keys={formatCombo(combo)} />
											</span>
										))}
									</span>
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
			<div className="mt-6 flex justify-end">
				<Button onClick={onClose}>Close</Button>
			</div>
		</Dialog>
	);
}
