/**
 * cloudinaryService.js — Direct Cloudinary upload from browser
 * Cloud Name: t3dkhv0z | Dynamic folders per user UID
 * Uses unsigned upload preset for client-side uploads.
 */

const CLOUD_NAME = import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME || 't3dkhv0z';
const UNSIGNED_PRESET = import.meta.env?.VITE_CLOUDINARY_PRESET || 'zulora_unsigned';

/**
 * Upload a File/Blob to Cloudinary with progress reporting.
 * @param {File|Blob} file
 * @param {string} folder  e.g. 'users/uid123/chat'
 * @param {Function} onProgress  ({ percent }) => void
 * @param {number} timeoutMs  default 90s
 * @returns {Promise<{ url, publicId, resourceType, width, height }>}
 */
export async function uploadToCloudinary(file, folder = '', onProgress, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const resolveOnce = finish(resolve);
    const rejectOnce = finish(reject);
    const reportProgress = progress => {
      try { onProgress?.(progress); }
      catch (error) { console.warn('Cloudinary progress callback failed:', error); }
    };
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UNSIGNED_PRESET);
    if (folder) formData.append('folder', folder);

    const resourceType = file.type?.startsWith('video/') ? 'video'
      : file.type?.startsWith('image/') ? 'image'
      : 'raw';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) reportProgress({ percent: Math.round((e.loaded / e.total) * 100) });
    });

    timer = setTimeout(() => {
      xhr.abort();
      rejectOnce(new Error(`Cloudinary upload timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data.secure_url) throw new Error('Cloudinary did not return a secure file URL.');
          reportProgress({ percent: 100 });
          resolveOnce({
            url: data.secure_url,
            publicId: data.public_id,
            resourceType: data.resource_type,
            width: data.width || 0,
            height: data.height || 0,
            bytes: data.bytes || file.size,
            format: data.format || ''
          });
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error('Cloudinary returned invalid JSON'));
        }
      } else {
        let msg = `Cloudinary HTTP ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText)?.error?.message || msg; } catch {}
        rejectOnce(new Error(msg));
      }
    };

    xhr.onerror = () => rejectOnce(new Error('Cloudinary network error'));
    xhr.onabort = () => rejectOnce(new Error('Cloudinary upload aborted'));
    try { xhr.send(formData); }
    catch (error) { rejectOnce(error instanceof Error ? error : new Error('Cloudinary upload could not start.')); }
  });
}

/**
 * Get optimized Cloudinary URL with transformations.
 */
export function getCloudinaryUrl(publicId, { width, height, quality = 'auto', format = 'auto' } = {}) {
  const transforms = [
    width ? `w_${width}` : '',
    height ? `h_${height}` : '',
    `q_${quality}`,
    `f_${format}`
  ].filter(Boolean).join(',');
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transforms}/${publicId}`;
}

export default uploadToCloudinary;
