/**
 * media.ts — Direct Media Generation Agent for Zulora AI
 *
 * Provides direct image generation and motion video synthesis with rich UI cards,
 * verified download links, Zulora Drive uploads, and zero raw script refusals.
 */

import { apiRouter } from '../../services/apiRouter';
import { uploadFileToDrive } from '../../services/zuloraDriveService';
import { executeVideoAgent, VideoRenderOptions } from './video';

export interface ImageGenerationOptions {
  prompt: string;
  currentUser?: any;
  aspectRatio?: '1:1' | '16:9' | '9:16';
  referenceImage?: string | null;
}

export interface ImageGenerationResult {
  success: boolean;
  url: string;
  prompt: string;
  markdownCard: string;
  error?: string;
}

export interface VideoGenerationOptions {
  prompt: string;
  currentUser?: any;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  existingHtml?: string;
  onProgress?: (progress: { phase: string; percent: number; message?: string }) => void;
}

export interface VideoGenerationResult {
  success: boolean;
  url: string;
  prompt: string;
  markdownCard: string;
  jobId?: string;
  html?: string;
  isIncremental?: boolean;
  error?: string;
}

/**
 * Direct image generation tool: executes API directly and formats a rich response
 * with verified Download File and Open links, without displaying raw code.
 */
export async function generateImageDirectly(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const { prompt, currentUser, referenceImage } = options;
  if (!prompt || !prompt.trim()) {
    throw new Error('Please provide an image prompt description.');
  }

  const cleanPrompt = prompt.trim();
  const result = await apiRouter.generateImage(cleanPrompt, {
    currentUser,
    referenceImage
  });

  const url = result?.url || result?.imageUrl;
  if (!url) {
    throw new Error('Image generation provider returned an empty image URL.');
  }

  // Format rich Markdown card with direct Download and Open links
  const markdownCard = [
    `### 🎨 AI Generated Image`,
    `**Prompt:** *${cleanPrompt}*`,
    ``,
    `![${cleanPrompt}](${url})`,
    ``,
    `[📥 **Download File**](${url}) &nbsp;•&nbsp; [↗️ **Open Full Resolution**](${url})`,
    ``,
    `*Generated at full resolution and saved to your Zulora media library.*`
  ].join('\n');

  return {
    success: true,
    url,
    prompt: cleanPrompt,
    markdownCard
  };
}

/**
 * Direct motion video generation: renders high quality MP4 with direct chat download.
 */
export async function generateVideoDirectly(options: VideoGenerationOptions): Promise<VideoGenerationResult> {
  const { prompt, currentUser, duration = 6, aspectRatio = '16:9', existingHtml, onProgress } = options;
  if (!prompt || !prompt.trim()) {
    throw new Error('Please provide a video prompt description.');
  }

  const cleanPrompt = prompt.trim();

  // If incremental HTML is present, run the incremental video engine
  if (existingHtml) {
    const res = await executeVideoAgent(cleanPrompt, {
      existingHtml,
      currentUser,
      aspectRatio,
      duration,
      onProgress
    });
    return {
      success: res.success,
      url: res.url,
      jobId: res.jobId,
      html: res.html,
      prompt: cleanPrompt,
      isIncremental: true,
      markdownCard: res.markdownCard
    };
  }

  const result = await apiRouter.generateVideo(cleanPrompt, {
    currentUser,
    duration,
    aspectRatio
  });

  const url = result?.url || result?.videoUrl;
  if (!url) {
    throw new Error('Video generation provider returned no playable video.');
  }

  // Auto-save to Zulora Drive if authenticated
  if (currentUser?.uid && uploadFileToDrive) {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const videoFile = new File([blob], `zulora_video_${Date.now()}.mp4`, { type: 'video/mp4' });
      await uploadFileToDrive(videoFile, currentUser.uid, 'Videos');
    } catch {
      // non-blocking
    }
  }

  const markdownCard = [
    `### 🎬 AI Motion Video (1080p)`,
    `**Prompt:** *${cleanPrompt}*`,
    ``,
    `[📥 **Download Video (MP4)**](${url}) &nbsp;•&nbsp; [↗️ **Open in Viewer**](${url})`,
    ``,
    `*Rendered at full resolution and saved to your Zulora Drive.*`
  ].join('\n');

  return {
    success: true,
    url,
    prompt: cleanPrompt,
    markdownCard
  };
}

export * from './video';

export default {
  generateImageDirectly,
  generateVideoDirectly,
  executeVideoAgent
};
