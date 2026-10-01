import { useCallback, useEffect, useRef, useState } from "react";
import { useEvent } from "expo";
import type { VideoPlayer } from "expo-video";
import { streamFacts } from "../../playback/streamInfo";
import type { ResolvedStream } from "../../playback/resolveStream";

/** A live picture stuck refilling this long is reloaded, at most this many times. */
const STUCK_AFTER_MS = 12_000;
const MAX_RELOADS = 4;
/** How long a live feed may take to show a picture before the next one is tried. */
const START_WITHIN_MS = 15_000;
/** A live picture paused for longer than this has fallen behind the broadcast. */
const BEHIND_AFTER_MS = 2000;

/**
 * Everything the screen does about a stream that is not behaving: reload a live picture that sticks, move to the next
 * feed or copy when one dies or never starts, try the source's other addresses, say which feed took over, and notice
 * when a paused live picture has fallen behind the broadcast.
 */
export function usePlaybackHealth({ player, stream, vod, timeshift, moreFeeds, fellBack, onFailOver, onServerDown }: { player: VideoPlayer; stream: ResolvedStream; vod: boolean; timeshift: boolean; moreFeeds: boolean; fellBack: string | undefined; onFailOver: () => void; onServerDown: (raw: string) => Promise<boolean> | null }) {
  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { videoTrack } = useEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const facts = streamFacts(videoTrack);
  const everPlayed = useRef(false);
  useEffect(() => {
    if (status === "readyToPlay") everPlayed.current = true;
  }, [status]);
  // Live TV: a picture that stays stuck refilling is asked for again from the start, a few times, before giving up.
  const reloads = useRef(0);
  useEffect(() => {
    if (vod || timeshift || status !== "loading" || !everPlayed.current || reloads.current >= MAX_RELOADS) return;
    const timer = setTimeout(() => {
      reloads.current += 1;
      player.replace(stream.url);
      player.play();
    }, STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [player, status, stream.url, timeshift, vod]);
  // A live channel that errors is tried on its next feed, if it has one.
  // A film's next copy is only tried when this one never really played (a 4K copy the hardware cannot decode fails
  // just after it is ready): one that fails part-way through says so instead.
  const playingSince = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (isPlaying) playingSince.current ??= Date.now();
  }, [isPlaying]);
  const failing = status === "error" && !timeshift && moreFeeds;
  // With no other feed or copy left, a server that cannot be reached is tried on the source's other addresses.
  const [otherServer, setOtherServer] = useState<"checking" | "none">();
  const serverDownRef = useRef(onServerDown);
  serverDownRef.current = onServerDown;
  useEffect(() => {
    if (status !== "error" || failing || otherServer !== undefined) return;
    const trying = serverDownRef.current(error?.message ?? "");
    if (trying === null) return;
    setOtherServer("checking");
    void trying.then((changed) => {
      if (!changed) setOtherServer("none");
    });
  }, [status, failing, otherServer, error]);
  useEffect(() => {
    if (failing && (!vod || playingSince.current === undefined || Date.now() - playingSince.current < 8000)) onFailOver();
  }, [failing, onFailOver, vod]);
  // Some dead streams never error, they just never start: after a while, the next feed is tried instead.
  const neverStarted = !timeshift && moreFeeds && status !== "readyToPlay" && status !== "error";
  useEffect(() => {
    if (!neverStarted || everPlayed.current) return;
    const timer = setTimeout(() => {
      if (!everPlayed.current) onFailOver();
    }, START_WITHIN_MS);
    return () => clearTimeout(timer);
  }, [neverStarted, onFailOver]);
  // Once the picture is up on a feed that was not the first, say which, for a moment.
  const [fellBackShown, setFellBackShown] = useState(false);
  const pictureUp = status === "readyToPlay";
  const fellBackSaid = useRef(false);
  useEffect(() => {
    if (fellBack === undefined || !pictureUp || fellBackSaid.current) return;
    fellBackSaid.current = true;
    setFellBackShown(true);
  }, [fellBack, pictureUp]);
  useEffect(() => {
    if (!fellBackShown) return;
    const timer = setTimeout(() => setFellBackShown(false), 5000);
    return () => clearTimeout(timer);
  }, [fellBackShown]);

  // Live TV: pausing lets the picture fall behind the broadcast. Once it has, there is a way back to live.
  const [behindLive, setBehindLive] = useState(false);
  const pausedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (vod || timeshift) return;
    // Only a real pause counts: not the picture still starting up, and not a stall while it refills.
    if (!isPlaying && status === "readyToPlay" && everPlayed.current) pausedAt.current ??= Date.now();
    else if (isPlaying && pausedAt.current !== undefined) {
      if (Date.now() - pausedAt.current > BEHIND_AFTER_MS) setBehindLive(true);
      pausedAt.current = undefined;
    }
  }, [isPlaying, status, timeshift, vod]);
  const goLive = useCallback(() => {
    setBehindLive(false);
    pausedAt.current = undefined;
    player.replace(stream.url);
    player.play();
  }, [player, stream.url]);
  return { status, error, isPlaying, facts, everPlayed, failing, otherServer, fellBackShown, behindLive, goLive };
}
