/** Plain-language facts about the stream being played, from what the player reports. */

interface TrackLike {
  readonly size: { readonly width: number; readonly height: number };
  readonly mimeType: string | null;
  readonly frameRate: number | null;
  readonly peakBitrate: number | null;
  readonly averageBitrate: number | null;
  readonly videoRange?: string | null;
}

/** "4K", "1080p", "720p", "SD": what people call the picture size. Width counts too, since wide films are letterboxed. */
export function qualityLabel(width: number, height: number): string | null {
  if (width <= 0 || height <= 0) return null;
  if (width >= 3200 || height >= 2000) return "4K";
  if (width >= 2400 || height >= 1300) return "1440p";
  if (width >= 1800 || height >= 1000) return "1080p";
  if (width >= 1200 || height >= 700) return "720p";
  return "SD";
}

export function codecLabel(mimeType: string | null): string | null {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("hevc") || mime.includes("h265")) return "HEVC";
  if (mime.includes("avc") || mime.includes("h264")) return "H.264";
  if (mime.includes("av01") || mime.includes("av1")) return "AV1";
  if (mime.includes("vp9")) return "VP9";
  if (mime.includes("mpeg2") || mime.includes("mpeg-2")) return "MPEG-2";
  return null;
}

export function fpsLabel(frameRate: number | null): string | null {
  if (frameRate === null || !Number.isFinite(frameRate) || frameRate <= 0) return null;
  const rounded = Math.round(frameRate * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0$/, "")} fps`;
}

export function bitrateLabel(bitsPerSecond: number | null): string | null {
  if (bitsPerSecond === null || !Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return null;
  const mbps = bitsPerSecond / 1_000_000;
  return mbps >= 1 ? `${mbps.toFixed(mbps >= 10 ? 0 : 1)} Mbps` : `${Math.round(bitsPerSecond / 1000)} kbps`;
}

export function hdrLabel(range: string | null | undefined): string | null {
  const value = (range ?? "").toLowerCase();
  return value === "pq" ? "HDR" : value === "hlg" ? "HLG" : null;
}

export interface StreamFacts {
  readonly quality: string | null;
  readonly size: string | null;
  readonly fps: string | null;
  readonly codec: string | null;
  readonly bitrate: string | null;
  readonly hdr: string | null;
}

export function streamFacts(track: TrackLike | null): StreamFacts {
  if (track === null) return { quality: null, size: null, fps: null, codec: null, bitrate: null, hdr: null };
  const { width, height } = track.size;
  return {
    quality: qualityLabel(width, height),
    size: width > 0 && height > 0 ? `${width} x ${height}` : null,
    fps: fpsLabel(track.frameRate),
    codec: codecLabel(track.mimeType),
    bitrate: bitrateLabel(track.peakBitrate ?? track.averageBitrate),
    hdr: hdrLabel(track.videoRange),
  };
}
