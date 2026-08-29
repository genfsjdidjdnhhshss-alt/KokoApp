const DEFAULT_ASPECT = 9 / 16;

export function mediaAspectOf(clip) {
  const width = Number(clip?.mediaWidth) || Number(clip?.width) || 0;
  const height = Number(clip?.mediaHeight) || Number(clip?.height) || 0;
  if (width >= 8 && height >= 8) return width / height;
  return 0;
}

export function canvasAspectOf(clips) {
  const list = Array.isArray(clips) ? clips : [];
  for (let i = 0; i < list.length; i += 1) {
    const aspect = mediaAspectOf(list[i]);
    if (aspect > 0.05 && aspect < 20) return aspect;
  }
  return DEFAULT_ASPECT;
}

export function fitCanvas(stageW, stageH, aspect, pad = 14) {
  const maxW = Math.max(1, Number(stageW) - pad * 2);
  const maxH = Math.max(1, Number(stageH) - pad * 2);
  const ratio = aspect > 0.05 && aspect < 20 ? aspect : DEFAULT_ASPECT;
  let width = maxW;
  let height = width / ratio;
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  return {
    width: Math.max(2, Math.round(width)),
    height: Math.max(2, Math.round(height)),
  };
}

export function coverLayerSize(canvasW, canvasH, mediaAspect) {
  const cw = Math.max(1, Number(canvasW) || 1);
  const ch = Math.max(1, Number(canvasH) || 1);
  const ca = cw / ch;
  const ma = mediaAspect > 0.05 && mediaAspect < 20 ? mediaAspect : ca;
  if (ma > ca) {
    return { width: Math.round(ch * ma), height: ch };
  }
  if (ma < ca) {
    return { width: cw, height: Math.round(cw / ma) };
  }
  return { width: cw, height: ch };
}

export function canvasPixelsFromAspect(aspect, longEdge) {
  const long = Math.max(64, Math.round(Number(longEdge) || 1080));
  const ratio = aspect > 0.05 && aspect < 20 ? aspect : DEFAULT_ASPECT;
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  if (ratio >= 1) {
    return { width: even(long), height: even(long / ratio) };
  }
  return { width: even(long * ratio), height: even(long) };
}
