import type { TimedChunk } from './aligner';

// 懒加载 transformers.js，避免首屏下载。
// 如果用户没有 @xenova/transformers，会在调用 transcribe 时报一个友好的错误。
type Pipeline = (
  audio: Float32Array | string,
  options?: Record<string, unknown>,
) => Promise<unknown>;

let asrPipeline: Pipeline | null = null;

export interface TranscribeProgress {
  stage: 'loading-model' | 'downloading' | 'transcribing' | 'done';
  progress?: number; // 0~1
  message?: string;
}

async function getPipeline(
  onProgress?: (p: TranscribeProgress) => void,
): Promise<Pipeline> {
  if (asrPipeline) return asrPipeline;
  onProgress?.({ stage: 'loading-model', message: '加载 Whisper 模型…' });

  let mod: typeof import('@xenova/transformers');
  try {
    // 动态 import；TS 在没装包时会报 missing types，加 @vite-ignore 容错。
    mod = await import(/* @vite-ignore */ '@xenova/transformers');
  } catch (e) {
    throw new Error(
      '未安装 @xenova/transformers。请运行 `npm install @xenova/transformers` 后重试，或改用"手动模式"。',
    );
  }
  const { pipeline, env } = mod;
  // 允许从远端下载模型（默认 true，但显式设置以防被覆盖）。
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  // Xenova/whisper-base 体积适中（~150 MB），中英文均可。
  const p = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
    progress_callback: (info: { status: string; progress?: number; file?: string }) => {
      if (info.status === 'progress') {
        onProgress?.({
          stage: 'downloading',
          progress: (info.progress ?? 0) / 100,
          message: `下载模型文件 ${info.file ?? ''}`,
        });
      }
    },
  });
  asrPipeline = p as unknown as Pipeline;
  return asrPipeline;
}

// 把任意音频文件解码为 16kHz 单声道 Float32Array（Whisper 要求）。
async function decodeTo16kMono(file: File): Promise<Float32Array> {
  const arrayBuf = await file.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const tmpCtx = new Ctx();
  const decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
  await tmpCtx.close();

  // 取第一个声道（单声道化最简方案：取均值）
  const ch0 = decoded.getChannelData(0);
  let mono: Float32Array;
  if (decoded.numberOfChannels > 1) {
    const ch1 = decoded.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  } else {
    mono = new Float32Array(ch0);
  }

  // 用 OfflineAudioContext 做重采样到 16kHz
  if (decoded.sampleRate === 16000) return mono;
  const targetRate = 16000;
  const targetLen = Math.ceil((mono.length * targetRate) / decoded.sampleRate);
  const offline = new OfflineAudioContext(1, targetLen, targetRate);
  const buf = offline.createBuffer(1, mono.length, decoded.sampleRate);
  // 复制到第 0 声道；用循环避免 typed-array buffer 类型不一致的问题。
  const channelData = buf.getChannelData(0);
  channelData.set(mono);
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice(0);
}

export interface TranscribeOptions {
  language?: 'chinese' | 'english' | 'auto';
}

export async function transcribe(
  file: File,
  opts: TranscribeOptions = {},
  onProgress?: (p: TranscribeProgress) => void,
): Promise<TimedChunk[]> {
  const audio = await decodeTo16kMono(file);
  const pipe = await getPipeline(onProgress);

  onProgress?.({ stage: 'transcribing', message: '正在识别音频…' });
  const lang = opts.language ?? 'auto';
  const result = (await pipe(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: 'word',
    language: lang === 'auto' ? undefined : lang,
    task: 'transcribe',
  })) as {
    text: string;
    chunks?: { text: string; timestamp: [number, number | null] }[];
  };

  onProgress?.({ stage: 'done', message: '识别完成' });

  if (!result.chunks || result.chunks.length === 0) {
    return [{ text: result.text, start: 0, end: 0 }];
  }

  return result.chunks.map((c) => ({
    text: c.text,
    start: c.timestamp[0] ?? 0,
    end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3,
  }));
}
