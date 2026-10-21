import type {
	TranscriptionModel,
	TranscriptionModelId,
} from "./types";

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-tiny",
		name: "极速版",
		huggingFaceId: "onnx-community/whisper-tiny",
		description: "速度最快，准确率较低",
	},
	{
		id: "whisper-small",
		name: "标准版",
		huggingFaceId: "onnx-community/whisper-small",
		description: "速度与准确率均衡",
	},
	{
		id: "whisper-medium",
		name: "高精度版",
		huggingFaceId: "onnx-community/whisper-medium",
		description: "准确率更高，速度较慢",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "旗舰版",
		huggingFaceId: "onnx-community/whisper-large-v3-turbo",
		description: "准确率最高，需 WebGPU 才能流畅运行",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-small";
