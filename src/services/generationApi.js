export class GenerationApiError extends Error {
  constructor(message, status, payload = {}) {
    super(message);
    this.name = 'GenerationApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** Calls the authenticated server route when it is available (production/Vercel). */
export async function requestGeneration(action, payload, currentUser) {
  if (!currentUser?.getIdToken) return null;

  let token;
  try {
    token = await currentUser.getIdToken();
  } catch {
    return null;
  }

  let response;
  try {
    response = await fetch('/api/ai', {
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

export async function trackSuccessfulUsage(type, currentUser) {
  try {
    const result = await requestGeneration('usage', { usageType: type }, currentUser);
    return result?.usage || { type, tracked: false };
  } catch (error) {
    if (error.status !== 403) console.warn(`[Usage] Could not sync ${type} quota to the server:`, error.message);
    return { type, tracked: false };
  }
}
