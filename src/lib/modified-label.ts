const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * When a file last changed, as a file list says it, in the machine's own
 * time: "Today, 09:12", "Yesterday, 16:40", or "12 Nov 2026". A stored time
 * is UTC; this is the edge where it becomes local (data.md section 4).
 */
export function modifiedLabel(iso: string | null, now: Date = new Date()): string {
	if (!iso) return "";
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return "";
	const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	const days = Math.round((day(now) - day(at)) / 86_400_000);
	const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
	if (days === 0) return `Today, ${time}`;
	if (days === 1) return `Yesterday, ${time}`;
	return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}
