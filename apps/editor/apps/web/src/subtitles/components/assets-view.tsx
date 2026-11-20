import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useReducer, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionSegment,
} from "@/transcription/types";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { runPluginOnAsset } from "@/timeline/plugin-apply";
import {
	getMediaFid,
	registerMediaFid,
	uploadFileToLibrary,
} from "@/services/cloud-snapshots";
import { getClipTimeAtSourceTime } from "@/retime/resolve";
import { mediaTimeToSeconds } from "@/wasm";
import type { RetimeConfig } from "@/timeline/types";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();
	const { selectedElements } = useElementSelection();

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const insertCaptions = ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	/**
	 * 识别选中片段（服务端 type=subtitle，runner 走 faster-whisper）。
	 *
	 * 浏览器端 Whisper 已移除（上百 MB 模型 + 与合成器抢 GPU），
	 * 而"整条时间线混音后识别"需要先把混音结果上传换 fid，目前只做单片段。
	 */
	const handleGenerateTranscript = async () => {
		const found = editor.timeline
			.getElementsWithTracks({ elements: selectedElements })[0];
		const element = found?.element;
		if (!element || (element.type !== "video" && element.type !== "audio")) {
			dispatch({
				type: "fail",
				error: "请先在时间线上选中一个视频或音频片段",
			});
			return;
		}

		dispatch({ type: "start", step: "准备素材" });
		try {
			const mediaId = (element as { mediaId?: string }).mediaId ?? null;
			let fid = mediaId ? getMediaFid(mediaId) : null;
			// 本地导入的素材没有 fid：服务端按 fid 读字节，先自动入库（与人声分离同一套路）。
			if (!fid && mediaId) {
				const localFile = editor.media
					.getAssets()
					.find((asset) => asset.id === mediaId)?.file;
				if (localFile) {
					dispatch({ type: "update_step", step: "本地素材先入库" });
					fid = await uploadFileToLibrary(localFile);
					registerMediaFid(mediaId, fid);
				}
			}
			if (!fid) {
				throw new Error("这个素材不在素材库里，服务端读不到文件，无法识别");
			}

			const { result } = await runPluginOnAsset({
				pluginType: "subtitle",
				pluginName: "AI 字幕",
				fid,
				params: { language: selectedLanguage },
				onProgress: (stage, percent) =>
					dispatch({ type: "update_step", step: `${stage} ${percent}%` }),
			});

			const raw = Array.isArray(result?.segments)
				? (result.segments as Array<{
						start: number;
						end: number;
						text: string;
					}>)
				: [];
			if (raw.length === 0) {
				dispatch({ type: "fail", error: "没有识别到任何语音" });
				return;
			}

			// runner 给的是「源素材时间轴」的秒数：先减 trimStart、再按变速换算，
			// 最后加上片段在时间线上的起点，才是字幕该落的位置。
			const trimStart = mediaTimeToSeconds({ time: element.trimStart });
			const clipStart = mediaTimeToSeconds({ time: element.startTime });
			const clipDuration = mediaTimeToSeconds({ time: element.duration });
			const retime = (element as { retime?: RetimeConfig }).retime;
			const segments: TranscriptionSegment[] = [];
			for (const item of raw) {
				const text = String(item?.text ?? "").trim();
				if (!text || !Number.isFinite(item?.start)) continue;
				const fromClip = getClipTimeAtSourceTime({
					sourceTime: item.start - trimStart,
					retime,
				});
				const toClip = getClipTimeAtSourceTime({
					sourceTime: (Number.isFinite(item?.end) ? item.end : item.start) - trimStart,
					retime,
				});
				if (toClip <= 0 || fromClip >= clipDuration) continue;
				const start = clipStart + Math.max(0, fromClip);
				const end = clipStart + Math.min(clipDuration, toClip);
				segments.push({ text, start, end: Math.max(end, start + 0.2) });
			}

			const captions = buildCaptionChunks({ segments });
			if (!insertCaptions({ captions })) {
				dispatch({ type: "fail", error: "没有生成任何字幕" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "发生未知错误",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "Reading subtitle file..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: "Importing subtitles..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "没有生成任何字幕" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "发生未知错误",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="字幕"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="语言">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="选择识别语言" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">自动检测</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					<Button
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={
							isProcessing ||
							selectedElements.length === 0 ||
							activeDiagnostics.length > 0
						}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : "识别选中片段生成字幕"}
					</Button>
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
