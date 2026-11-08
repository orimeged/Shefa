/**
 * Prepares a photo of a list for upload. A phone camera writes several megabytes,
 * which is slow on a store's weak signal and far more than handwriting needs.
 * Drawing it again also leaves behind the location the camera stored in the file.
 */

const MAX_SIDE_PX = 1600;
const JPEG_QUALITY = 0.8;

export function fitWithin(
  width: number,
  height: number,
  maxSide: number = MAX_SIDE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The photo couldn't be decoded"));
    image.src = url;
  });
}

/** The photo as a small JPEG, or the original when this browser can't decode it. */
export async function shrinkPhoto(photo: File): Promise<Blob> {
  const url = URL.createObjectURL(photo);
  try {
    const image = await loadImage(url);
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    const shrunk = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    return shrunk ?? photo;
  } catch {
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}
