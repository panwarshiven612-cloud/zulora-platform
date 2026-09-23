export async function imageFileToDataUrl(file, { maxDimension = 1280, maxBytes = 900_000 } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file.');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > maxBytes && quality > 0.5) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  if (dataUrl.length * 0.75 > maxBytes && Math.max(canvas.width, canvas.height) > 900) {
    const resized = document.createElement('canvas');
    const secondScale = 900 / Math.max(canvas.width, canvas.height);
    resized.width = Math.round(canvas.width * secondScale);
    resized.height = Math.round(canvas.height * secondScale);
    resized.getContext('2d').drawImage(canvas, 0, 0, resized.width, resized.height);
    dataUrl = resized.toDataURL('image/jpeg', 0.68);
  }
  if (dataUrl.length * 0.75 > maxBytes) throw new Error('This image is too large to attach. Choose a smaller image.');
  return dataUrl;
}
