export async function downloadMedia(url, filename) {
  const source = String(url || '');
  const sameOrigin = source.startsWith('data:') || source.startsWith(window.location.origin);
  const requestUrl = sameOrigin
    ? source
    : `/api/media-download?url=${encodeURIComponent(source)}&filename=${encodeURIComponent(filename)}`;

  try {
    const response = await fetch(requestUrl);
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const type = response.headers.get('content-type') || '';
    if (type.includes('xml') || type.includes('text/html')) throw new Error('Provider returned an error page');
    const blob = await response.blob();
    const extensions = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm' };
    const extension = extensions[blob.type] || extensions[type.split(';')[0]];
    const finalName = extension ? `${filename.replace(/\.[^.]+$/, '')}.${extension}` : filename;
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = finalName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  } catch (error) {
    if (!sameOrigin) {
      window.open(source, '_blank', 'noopener,noreferrer');
      return;
    }
    throw error;
  }
}
