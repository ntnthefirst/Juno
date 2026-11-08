import type { NewRecordKind, NewRecordPrefill } from "@shared/types";
import { NewClientWindow } from "../features/new-record/NewClientWindow";
import { NewEventWindow } from "../features/new-record/NewEventWindow";
import { NewProjectWindow } from "../features/new-record/NewProjectWindow";
import { useThemeSync } from "../lib/theme";

type NewRecordWindowProps = {
	record: NewRecordKind;
	prefill: NewRecordPrefill;
};

/**
 * The shell of a new-record window (decision 60), chosen by the address the
 * main process loaded it with. Each is a modal child of the main window, a
 * fixed size, and closes through `closeNewRecord`, which tells the screen
 * behind it to refresh when something was saved.
 */
export function NewRecordWindow({ record, prefill }: NewRecordWindowProps) {
	// The theme is application-wide, so this window follows the one the main window has.
	useThemeSync();
	switch (record) {
		case "event":
		case "reminder":
			// One window with a switch between the two (frames 175:12676 and 184:399).
			return <NewEventWindow kind={record} prefill={prefill} />;
		case "client":
			return <NewClientWindow />;
		case "project":
			return <NewProjectWindow prefill={prefill} />;
	}
}
