import { apiKey } from './env';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface InlineFile { mimeType: string; data: Buffer }

/** Errors that retrying cannot fix (e.g. the project spend cap). */
export class FatalError extends Error {}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** POST with retries on 429 / 5xx / network errors. */
async function post(url: string, body: unknown, label: string, attempts = 7): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
      if (res.ok) return await res.json();
      const text = await res.text();
      if (text.includes('spending cap')) {
        throw new FatalError(`${label}: the Gemini project hit its monthly spending cap. Raise it at https://ai.studio/spend and re-run (finished assets are kept).`);
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
        // Spend/rate limits need a real cool-down: 15s, 30s, 60s … capped at 4 min.
        const wait = Math.min(240_000, (res.status === 429 ? 15_000 : 4_000) * 2 ** i) + Math.random() * 3000;
        if (res.status === 429) console.warn(`  … ${label}: rate limited, retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 600)}`);
    } catch (e: any) {
      lastErr = e;
      if (e instanceof FatalError) throw e;
      if (String(e?.message).includes('HTTP 4') && !String(e?.message).includes('HTTP 429')) throw e;
      await sleep(3000 * 2 ** i);
    }
  }
  throw lastErr;
}

function collectInline(json: any): InlineFile[] {
  const out: InlineFile[] = [];
  for (const c of json?.candidates ?? []) {
    for (const p of c?.content?.parts ?? []) {
      if (p.inlineData?.data) out.push({ mimeType: p.inlineData.mimeType, data: Buffer.from(p.inlineData.data, 'base64') });
    }
  }
  return out;
}

export const IMAGE_MODELS = {
  flash: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image',
} as const;

export interface ImageRequest {
  model: keyof typeof IMAGE_MODELS;
  prompt: string;
  aspect?: string;
  size?: '1K' | '2K' | '4K';
  refs?: InlineFile[];
}

/** Text(+reference images) -> image. Retries when the model answers without an image. */
export async function generateImage(req: ImageRequest, label: string): Promise<InlineFile> {
  const parts: any[] = [];
  for (const r of req.refs ?? []) parts.push({ inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') } });
  parts.push({ text: req.prompt });
  const imageConfig: any = { aspectRatio: req.aspect ?? '1:1' };
  if (req.size) imageConfig.imageSize = req.size;
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig } };
  for (let i = 0; i < 3; i++) {
    const json = await post(`${BASE}/models/${IMAGE_MODELS[req.model]}:generateContent`, body, label);
    const img = collectInline(json).find((f) => f.mimeType.startsWith('image/'));
    if (img) return img;
    await sleep(2000);
  }
  throw new Error(`${label}: model returned no image`);
}

/** Lyria music: returns the first audio part (mp3). */
export async function generateMusic(model: string, prompt: string, label: string): Promise<InlineFile> {
  const json = await post(`${BASE}/models/${model}:generateContent`, { contents: [{ parts: [{ text: prompt }] }] }, label);
  const audio = collectInline(json).find((f) => f.mimeType.startsWith('audio/'));
  if (!audio) throw new Error(`${label}: no audio returned`);
  return audio;
}

/** Gemini TTS: returns wav. */
export async function generateSpeech(model: string, text: string, voice: string, label: string): Promise<InlineFile> {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };
  const json = await post(`${BASE}/models/${model}:generateContent`, body, label);
  const audio = collectInline(json).find((f) => f.mimeType.startsWith('audio/'));
  if (!audio) throw new Error(`${label}: no speech returned`);
  return audio;
}

/**
 * Sound effects via the omni model (Interactions API). It answers with a short
 * video whose soundtrack is the requested effect; we extract the audio later with ffmpeg.
 */
export async function generateSfxClip(model: string, prompt: string, label: string): Promise<InlineFile> {
  const json = await post(`${BASE}/interactions`, { model, input: prompt, response_modalities: ['audio'] }, label);
  for (const step of json?.steps ?? []) {
    for (const c of step?.content ?? []) {
      if (c?.data && (c.type === 'video' || c.type === 'audio')) return { mimeType: c.mime_type, data: Buffer.from(c.data, 'base64') };
    }
  }
  throw new Error(`${label}: no media returned`);
}

/** Asks a multimodal model a yes/no style question about an audio clip; expects a JSON answer. */
export async function askAboutAudio(
  audio: Buffer,
  mimeType: string,
  question: string,
  label: string,
): Promise<{ match: boolean; heard: string }> {
  const body = {
    contents: [{ parts: [{ inlineData: { mimeType, data: audio.toString('base64') } }, { text: question }] }],
    generationConfig: { responseMimeType: 'application/json' },
  };
  const json = await post(`${BASE}/models/gemini-3.5-flash:generateContent`, body, `${label} (qa)`);
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '{}';
  const parsed = JSON.parse(text);
  return { match: !!parsed.match, heard: String(parsed.heard ?? '') };
}
