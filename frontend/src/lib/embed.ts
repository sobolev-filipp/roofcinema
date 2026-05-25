/** Превратить ссылку на YouTube / Rutube в embed-URL.
 * Возвращает null, если ссылка не распознана. */
export function toEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // YouTube форматы: youtu.be/ID  |  youtube.com/watch?v=ID  |  youtube.com/embed/ID  |  youtube.com/shorts/ID
  const yt = trimmed.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([\w-]{11})/
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Rutube форматы: rutube.ru/video/HASH/ | rutube.ru/play/embed/HASH
  const rt = trimmed.match(/rutube\.ru\/(?:video|play\/embed)\/([\w-]+)/);
  if (rt) return `https://rutube.ru/play/embed/${rt[1]}/`;
  return null;
}
