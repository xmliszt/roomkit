export function getMediaSrc(src: string) {
  return /^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm)|application\/pdf|text\/(plain|markdown));base64,[A-Za-z0-9+/=\s]+$/.test(
    src,
  )
    ? src
    : undefined;
}
