import { Segmented } from "./panel-controls";
import { PREVIEW_WIDTHS, type PreviewWidth } from "./preview-width";

type WidthSwitchProps = {
	value: PreviewWidth;
	onChange: (value: PreviewWidth) => void;
};

/**
 * The three widths, as a control: a desktop, a tablet and a phone, with the
 * pixels in the tooltip.
 *
 * Shared between the canvas and the rendered message so the two are looked at
 * at the same width without anybody being asked twice.
 */
export function WidthSwitch({ value, onChange }: WidthSwitchProps) {
	return (
		<div className="w-[100px]">
			<Segmented
				label="Preview width"
				value={value}
				options={[
					{ value: "wide", label: "Wide", icon: "device-desktop", title: `Wide, ${PREVIEW_WIDTHS.wide} pixels` },
					{ value: "medium", label: "Medium", icon: "device-tablet", title: `Medium, ${PREVIEW_WIDTHS.medium} pixels` },
					{ value: "small", label: "Small", icon: "device-phone", title: `Small, ${PREVIEW_WIDTHS.small} pixels` },
				]}
				onChange={onChange}
			/>
		</div>
	);
}
