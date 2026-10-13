import { LoadPicturesNotice } from "../../../../components/LoadPicturesNotice";
import { useRemotePicture } from "../../../../lib/remote-pictures";

type PictureAddressNoticeProps = {
	address: string;
};

/** Offers to load the picture at an image block's address, so the canvas can draw it. */
export function PictureAddressNotice({ address }: PictureAddressNoticeProps) {
	const remote = useRemotePicture(/^https:\/\//i.test(address.trim()) ? address.trim() : "");
	return <LoadPicturesNotice pending={remote.pending} onConfirm={remote.confirm} />;
}
