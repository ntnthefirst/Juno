import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "./Menu";

type Point = { x: number; y: number };
type Target =
	| { kind: "field"; hasSelection: boolean; readOnly: boolean }
	| { kind: "text" };

type State = { at: Point; target: Target };

function fieldOf(node: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
	if (!(node instanceof Element)) return null;
	const found = node.closest("input, textarea");
	if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) return found;
	return null;
}

/**
 * The right-click menu every window falls back to: cut, copy, paste and select
 * all in a field, copy on selected text.
 *
 * Electron draws no context menu of its own, so without this a right click in a
 * text field does nothing, which reads as a broken window. It listens on the
 * document while bubbling, so any surface with a menu of its own takes
 * precedence simply by stopping the event, which `useContextMenu` already does.
 *
 * The commands go through the main process (`app.edit.*`), which runs them on
 * the focused element. No clipboard content crosses the bridge in either
 * direction.
 */
export function EditMenu() {
	const [state, setState] = useState<State | null>(null);

	useEffect(() => {
		function onContextMenu(event: MouseEvent) {
			if (event.defaultPrevented) return;

			const field = fieldOf(event.target);
			if (field && !field.disabled) {
				event.preventDefault();
				setState({
					at: { x: event.clientX, y: event.clientY },
					target: {
						kind: "field",
						hasSelection: field.selectionStart !== field.selectionEnd,
						readOnly: field.readOnly,
					},
				});
				return;
			}

			const selected = window.getSelection()?.toString() ?? "";
			if (selected.trim().length === 0) return;
			event.preventDefault();
			setState({ at: { x: event.clientX, y: event.clientY }, target: { kind: "text" } });
		}

		document.addEventListener("contextmenu", onContextMenu);
		return () => document.removeEventListener("contextmenu", onContextMenu);
	}, []);

	if (!state) return null;

	const { target } = state;
	const items: MenuItem[] =
		target.kind === "text"
			? [
					{
						id: "copy",
						label: "Copy",
						icon: "copy",
						onSelect: () => void window.juno.app.edit.copy(),
					},
				]
			: [
					{
						id: "cut",
						label: "Cut",
						icon: "cut",
						disabled: !target.hasSelection || target.readOnly,
						onSelect: () => void window.juno.app.edit.cut(),
					},
					{
						id: "copy",
						label: "Copy",
						icon: "copy",
						disabled: !target.hasSelection,
						onSelect: () => void window.juno.app.edit.copy(),
					},
					{
						id: "paste",
						label: "Paste",
						icon: "paste",
						disabled: target.readOnly,
						onSelect: () => void window.juno.app.edit.paste(),
					},
					{
						id: "select-all",
						label: "Select all",
						separatorBefore: true,
						onSelect: () => void window.juno.app.edit.selectAll(),
					},
				];

	return (
		<ContextMenu
			at={state.at}
			items={items}
			ariaLabel="Edit"
			onClose={() => setState(null)}
		/>
	);
}
