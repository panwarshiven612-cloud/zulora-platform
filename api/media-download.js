const ALLOWED_HOSTS = [
  'image.pollinations.ai', 'assets.mixkit.co', 'fal.media', 'fal.run',
  'picsum.photos', 'images.unsplash.com', 'firebasestorage.googleapis.com',
  'storage.googleapis.com', 'googleusercontent.com', 'firebasestorage.app'
];

const isAllowedHost = host => ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  let source;
  try {
    source = new URL(req.query.url);
    if (source.protocol !== 'https:' || !isAllowedHost(source.hostname)) throw new Error('Unsupported media host');
  } catch {
    return res.status(400).send('Invalid media URL');
  }

  try {
    const upstream = await fetch(source.href, { redirect: 'follow' });
    const finalUrl = new URL(upstream.url);
    if (!upstream.ok || finalUrl.protocol !== 'https:' || !isAllowedHost(finalUrl.hostname)) {
      return res.status(502).send('Media provider did not return a downloadable file');
    }
    const requestedName = String(req.query.filename || 'zulora-download').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (contentType.includes('xml') || contentType.includes('text/html')) return res.status(502).send('Media provider returned an error document');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${requestedName}"`);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (!upstream.body) return res.status(502).end();
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) await new Promise(resolve => res.once('drain', resolve));
    }
    return res.end();
  } catch (error) {
    console.error('Media download proxy failed:', error.message);
    return res.status(502).send('Unable to download media from provider');
  }
}
