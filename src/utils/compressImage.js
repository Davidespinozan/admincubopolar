import imageCompression from 'browser-image-compression';

// Comprime imagen con target ~1MB. Output siempre JPEG, max 1920px.
// Si falla, retorna el File original — el upload intenta con el grande
// y la red de seguridad de 5MB lo bloquea si excede.
export async function compressImage(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;

  try {
    return await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: 0.75,
    });
  } catch (e) {
    console.warn('[compressImage] falló, usando original:', e?.message || e);
    return file;
  }
}
