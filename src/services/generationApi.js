import { firestoreService } from './firestoreService';

export class GenerationApiError extends Error {
  constructor(message, status, payload = {}) {
    super(message);
    this.name = 'GenerationApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** Calls the authenticated server route when it is available (production/Vercel). */
export async function requestGeneration(action, payload, currentUser, endpoint = '/api/ai') {
  if (!currentUser?.getIdToken) return null;

  let token;
  try {
    token = await currentUser.getIdToken();
  } catch {
    return null;
  }

  let response;
  const timeoutMs = action === 'video' ? 52_000 : action === 'image' ? 48_000 : 35_000;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new GenerationApiError(`${action} generation timed out; switching to available fallbacks.`, 504);
    }
    return null;
  } finally {
    window.clearTimeout(timer);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') || response.status === 404) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GenerationApiError(data.error || `Generation request failed (HTTP ${response.status}).`, response.status, data);
  }
  if (data && typeof data === 'object') {
    data.provider ||= response.headers.get('x-ai-provider') || undefined;
    data.model ||= response.headers.get('x-ai-model') || undefined;
  }
  return data;
}

export async function requestLimits(currentUser) {
  if (!currentUser?.getIdToken) return null;
  let token;
  try { token = await currentUser.getIdToken(); } catch { return null; }
  try {
    const response = await fetch('/api/limits', { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) return null;
    const data = await response.json().catch(() => ({}));
    return response.ok ? data.usage || null : null;
  } catch { return null; }
}

/** Requests chat output as authenticated server-sent events and forwards each token to the UI. */
export async function requestGenerationStream(payload, currentUser, onToken, onReset, onProvider) {
  if (!currentUser?.getIdToken) return null;
  let token;
  try { token = await currentUser.getIdToken(); }
  catch { return null; }

  let response;
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'chat-stream', ...payload })
    });
  } catch { return null; }

  const contentType = response.headers.get('content-type') || '';
  if (response.status === 404) return null;
  if (!response.ok && !contentType.includes('text/event-stream')) {
    const data = await response.json().catch(() => ({}));
    throw new GenerationApiError(data.error || `Generation request failed (HTTP ${response.status}).`, response.status, data);
  }
  if (!contentType.includes('text/event-stream') || !response.body) {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new GenerationApiError(data.error || `Generation request failed (HTTP ${response.status}).`, response.status, data);
    }
    return null;
  }

  const headerProvider = response.headers.get('x-ai-provider');
  const headerModel = response.headers.get('x-ai-model');
  if (headerProvider || headerModel) onProvider?.({ provider: headerProvider || '', model: headerModel || '' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult = null;
  let receivedTokens = false;
  const consumeFrame = frame => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data) return;
    let value;
    try { value = JSON.parse(data); } catch { value = { token: data }; }
    if (event === 'token') {
      const tokenValue = String(value.token || '');
      if (tokenValue) receivedTokens = true;
      onToken?.(tokenValue);
    }
    if (event === 'reset') {
      receivedTokens = false;
      onReset?.();
    }
    if (event === 'provider') onProvider?.(value);
    if (event === 'done') finalResult = value;
    if (event === 'error') throw new GenerationApiError(value.error || 'The streamed response failed.', value.status || 502, value);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      frames.forEach(consumeFrame);
      if (done) break;
    }
    if (buffer.trim()) consumeFrame(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!finalResult && receivedTokens) throw new GenerationApiError('The response stream ended before it was complete.', 502);
  return finalResult;
}

/** Streams real text-to-video provider status from the authenticated video route. */
export async function requestVideoGeneration(payload, currentUser, onProgress, endpoint = '/api/video') {
  if (!currentUser?.getIdToken) return null;
  let token;
  try { token = await currentUser.getIdToken(); }
  catch { return null; }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 57_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'video-stream', ...payload }),
      signal: controller.signal
    });
  } catch (error) {
    window.clearTimeout(timer);
    if (error?.name === 'AbortError') throw new GenerationApiError('Video generation timed out. Try again.', 504);
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (response.status === 404) {
    window.clearTimeout(timer);
    return null;
  }
  if (!contentType.includes('text/event-stream') || !response.body) {
    try {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new GenerationApiError(data.error || `Video request failed (HTTP ${response.status}).`, response.status, data);
      data.provider ||= response.headers.get('x-ai-provider') || undefined;
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  const consumeFrame = frame => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data) return;
    let value;
    try { value = JSON.parse(data); } catch { value = { message: data }; }
    if (event === 'progress') onProgress?.(value);
    if (event === 'done') result = value;
    if (event === 'error') throw new GenerationApiError(value.error || 'Video generation failed.', value.status || 502, value);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      frames.forEach(consumeFrame);
      if (done) break;
    }
    if (buffer.trim()) consumeFrame(buffer);
  } finally {
    reader.releaseLock();
    window.clearTimeout(timer);
  }
  if (!result) throw new GenerationApiError('The video status stream ended before a video was ready.', 502);
  return result;
}

export async function checkGenerationAllowance(type, currentUser) {
  let result;
  try { result = await requestGeneration('allowance', { usageType: type }, currentUser); }
  catch (error) {
    if (error instanceof GenerationApiError && [403, 429].includes(error.status)) {
      return {
        allowed: false,
        upgradeRequired: Boolean(error.payload?.upgradeRequired),
        softCooldown: Boolean(error.payload?.softCooldown),
        cooldownUntil: error.payload?.cooldownUntil || error.payload?.usage?.cooldownUntil || null,
        usage: error.payload?.usage,
        tier: error.payload?.planTier
      };
    }
    throw error;
  }
  const serverAllowance = result?.allowance || null;
  if (serverAllowance && !serverAllowance.allowed) return serverAllowance;
  if (!currentUser?.uid) return serverAllowance;
  const clientAllowance = await firestoreService.checkUsageAllowance(currentUser.uid, type);
  if (clientAllowance && !clientAllowance.allowed) return clientAllowance;
  return serverAllowance || clientAllowance || null;
}

export async function trackSuccessfulUsage(type, currentUser, estimatedTokens = undefined) {
  try {
    const result = await requestGeneration('usage', { usageType: type, estimatedTokens }, currentUser);
    return result?.usage || { type, tracked: false };
  } catch (error) {
    if (error instanceof GenerationApiError && (error.status === 401 || error.status === 403 || error.status >= 500)) throw error;
    console.warn(`[Usage] Could not sync ${type} quota to the server:`, error.message);
    return { type, tracked: false };
  }
}
