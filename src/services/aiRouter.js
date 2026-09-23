import { auth, waitForAuthInitialization } from './firebase';

async function callGeneration(action, payload) {
  await waitForAuthInitialization();
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to use Zulora AI.');
  const request = token => fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload })
    });
  let response = await request(await user.getIdToken());
  if (response.status === 401 && auth.currentUser?.uid === user.uid) {
    response = await request(await user.getIdToken(true));
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The AI service returned an invalid response.'); }
  if (!response.ok) {
    const error = new Error(data.error || 'AI generation failed.');
    error.status = response.status;
    error.limit = data.limit;
    error.used = data.used;
    throw error;
  }
  return data;
}

export const aiRouter = {
  generateChat: payload => callGeneration('chat', payload),
  generateImage: payload => callGeneration('image', payload),
  generateVideo: payload => callGeneration('video', payload)
};

export default aiRouter;
