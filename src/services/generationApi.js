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
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action, ...payload })
    });
  } catch {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json') || response.status === 404) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GenerationApiError(data.error || `Generation request failed (HTTP ${response.status}).`, response.status, data);
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
export async function requestGenerationStream(payload, currentUser, onToken, onReset) {
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
  if (!currentUser?.uid) return result?.allowance || null;
  if (result?.allowance) return result.allowance;
  const clientAllowance = await firestoreService.checkUsageAllowance(currentUser.uid, type);
  if (clientAllowance && !clientAllowance.allowed) return clientAllowance;
  return result?.allowance || clientAllowance || null;
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
