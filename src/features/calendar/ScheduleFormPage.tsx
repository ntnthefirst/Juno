import { ReminderForm } from "../reminders/ReminderForm";
import { EventForm } from "./EventForm";
import type { ScheduleForm } from "./schedule-form";

type ScheduleFormPageProps = {
	form: ScheduleForm;
	/** Where back goes, in words: "Client" or "Project". */
	backLabel: string;
	onClose: () => void;
	onSaved: () => void;
};

export function ScheduleFormPage({ form, backLabel, onClose, onSaved }: ScheduleFormPageProps) {
	if (form.kind === "event") {
		return (
			<EventForm
				event={form.event}
				seed={form.seed}
				backLabel={backLabel}
				onClose={onClose}
				onSaved={onSaved}
			/>
		);
	}
	return (
		<ReminderForm
			reminder={form.reminder}
			seed={form.seed}
			backLabel={backLabel}
			onClose={onClose}
			onSaved={onSaved}
		/>
	);
}
