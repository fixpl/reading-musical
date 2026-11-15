import Root from "./confirm-dialog.svelte";

export type ConfirmReasonOptions = { label: string; required?: boolean; placeholder?: string };
export type ConfirmOptions = {
	title: string;
	description?: string;
	confirmLabel?: string;
	destructive?: boolean;
	reason?: ConfirmReasonOptions;
};
export type ConfirmResult = { confirmed: boolean; reason?: string };
export type ConfirmAsk = {
	(message: string, heading?: string, acceptLabel?: string): Promise<boolean>;
	(options: ConfirmOptions): Promise<ConfirmResult>;
};

export {
	Root,
	//
	Root as ConfirmDialog,
};
