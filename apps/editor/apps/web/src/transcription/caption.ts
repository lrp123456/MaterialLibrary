import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/transcription/caption-defaults";

const CJK_MAX_CHARS_PER_CAPTION = 16;
const CJK_TOKEN_PATTERN = /[^，。！？；：、,.!?;:]+[，。！？；：、,.!?;:]?/g;
const CJK_CHAR_PATTERN = /[一-鿿]/;

/**
 * Whisper 的中文 segment 常常是 20~40 字一整句，而下面的分块逻辑按空格数词，
 * 中文没空格 → 整句成一条超长字幕。这里先按标点切成适合上屏的短句，
 * 时间按字符数比例分摊；纯英文/已有空格的文本原样返回。
 */
function splitCjkSegment({
	segment,
	maxChars = CJK_MAX_CHARS_PER_CAPTION,
}: {
	segment: TranscriptionSegment;
	maxChars?: number;
}): TranscriptionSegment[] {
	const text = segment.text.trim();
	const isCjkBlock =
		CJK_CHAR_PATTERN.test(text) && !/\s/.test(text) && text.length > maxChars;
	if (!isCjkBlock) {
		return [segment];
	}

	const tokens = text.match(CJK_TOKEN_PATTERN) ?? [text];
	const pieces: string[] = [];
	for (const token of tokens) {
		// 单个标点片段仍然超长时硬切，否则一条字幕顶不满屏幕
		for (let i = 0; i < token.length; i += maxChars) {
			const slice = token.slice(i, i + maxChars);
			const last = pieces[pieces.length - 1];
			if (last && /[，。！？；：]$/.test(last) === false && (last + slice).length <= maxChars) {
				pieces[pieces.length - 1] = last + slice;
			} else {
				pieces.push(slice);
			}
		}
	}

	const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0);
	const duration = Math.max(0.001, segment.end - segment.start);
	let cursor = segment.start;
	return pieces.map((piece, index) => {
		const pieceDuration = (piece.length / Math.max(1, totalChars)) * duration;
		const start = cursor;
		cursor =
			index === pieces.length - 1
				? segment.end
				: Math.min(segment.end, cursor + pieceDuration);
		return { text: piece, start, end: cursor };
	});
}

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments.flatMap((item) => splitCjkSegment({ segment: item }))) {
		const words = segment.text.trim().split(/\s+/);
		if (words.length === 0 || (words.length === 1 && words[0] === "")) continue;

		const segmentDuration = segment.end - segment.start;
		const wordsPerSecond = words.length / segmentDuration;

		const chunks: string[] = [];
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
		}

		let chunkStartTime = segment.start;
		for (const chunk of chunks) {
			const chunkWords = chunk.split(/\s+/).length;
			const chunkDuration = Math.max(minDuration, chunkWords / wordsPerSecond);
			const adjustedStartTime = Math.max(chunkStartTime, globalEndTime);

			captions.push({
				text: chunk,
				startTime: adjustedStartTime,
				duration: chunkDuration,
			});

			globalEndTime = adjustedStartTime + chunkDuration;
			chunkStartTime += chunkDuration;
		}
	}

	return captions;
}
