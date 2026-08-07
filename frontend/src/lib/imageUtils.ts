export interface OptimizeImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: string;
}

export interface OptimizeCoverImageOptions {
  size?: number;
  quality?: number;
  outputType?: string;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    image.src = objectUrl;
  });
}

export async function optimizeImageFile(
  file: File,
  {
    maxWidth = 512,
    maxHeight = 512,
    quality = 0.82,
    outputType = 'image/webp',
  }: OptimizeImageOptions = {}
): Promise<File> {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Image processing is not supported in this browser');
  }

  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }

      reject(new Error('Failed to optimize image'));
    }, outputType, quality);
  });

  const extension = outputType.split('/')[1] || 'webp';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';

  return new File([blob], `${baseName}.${extension}`, { type: outputType });
}

export async function optimizeCoverImageFile(
  file: File,
  {
    size = 512,
    quality = 0.82,
    outputType = 'image/webp',
    zoom = 1,
    offsetX = 0,
    offsetY = 0,
  }: OptimizeCoverImageOptions = {}
): Promise<File> {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Image processing is not supported in this browser');
  }

  canvas.width = size;
  canvas.height = size;

  const normalizedZoom = Math.max(1, zoom);
  const scale = Math.max(size / image.width, size / image.height) * normalizedZoom;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
  const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
  const normalizedOffsetX = clamp(offsetX, -1, 1);
  const normalizedOffsetY = clamp(offsetY, -1, 1);

  const drawX = (size - drawWidth) / 2 + normalizedOffsetX * maxOffsetX;
  const drawY = (size - drawHeight) / 2 + normalizedOffsetY * maxOffsetY;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }

      reject(new Error('Failed to optimize cover image'));
    }, outputType, quality);
  });

  const extension = outputType.split('/')[1] || 'webp';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';

  return new File([blob], `${baseName}.${extension}`, { type: outputType });
}

export function getStorageObjectPathFromPublicUrl(publicUrl: string, bucket: string) {
  try {
    const url = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.pathname.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}
