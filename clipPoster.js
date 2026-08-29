export function toImageUri(path) {
  if (!path) return null;
  if (typeof path === 'string') {
    if (
      path.startsWith('file:')
      || path.startsWith('content:')
      || path.startsWith('http:')
      || path.startsWith('https:')
      || path.startsWith('ph://')
      || path.startsWith('assets-library:')
    ) {
      return path;
    }
    if (path.startsWith('/')) return `file://${path}`;
    return path;
  }
  if (typeof path?.uri === 'string') return toImageUri(path.uri);
  return null;
}

export async function ensureLocalVideo(source) {
  return source || null;
}

export async function ensurePoster(source, offsetSec = 0) {
  return null;
}

export async function ensureFilmstrip(source, durationSec, offsetSec = 0) {
  return [];
}
