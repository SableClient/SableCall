/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { getTrackReferenceId } from "@livekit/components-core";
import { type Room as LivekitRoom } from "livekit-client";
import { type RemoteAudioTrack, Track } from "livekit-client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useTracks,
  AudioTrack,
  type AudioTrackProps,
} from "@livekit/components-react";
import { logger as rootLogger } from "matrix-js-sdk/lib/logger";

import {
  useEarpieceAudioConfig,
  useMediaDevices,
} from "../MediaDevicesContext";
import { useReactiveState } from "../useReactiveState";
import { useBehavior } from "../useBehavior";
import { useObservableEagerState } from "observable-hooks";
import { useUrlParams } from "../UrlParams";
import { boostedParticipants$ } from "../state/participantVolume";
import * as controls from "../controls";

export interface MatrixAudioRendererProps {
  /**
   * The service URL of the LiveKit room.
   */
  url: string;
  livekitRoom: LivekitRoom;
  /**
   * The list of participant identities to render audio for.
   * This list needs to be composed based on the matrixRTC members so that we do not play audio from users
   * that are not expected to be in the rtc session (local user is excluded).
   */
  validIdentities: string[];
  /**
   * If set to `true`, mutes all audio tracks rendered by the component.
   * @remarks
   * If set to `true`, the server will stop sending audio track data to the client.
   */
  muted?: boolean;
}

/**
 * Takes care of handling remote participants’ audio tracks and makes sure that microphones and screen share are audible.
 *
 * It also takes care of the earpiece audio configuration for iOS devices.
 * This is done by using the WebAudio API to create a stereo pan effect that mimics the earpiece audio.
 * @example
 * ```tsx
 * <LiveKitRoom>
 *   <MatrixAudioRenderer />
 * </LiveKitRoom>
 * ```
 * @public
 */
export function LivekitRoomAudioRenderer({
  url,
  livekitRoom,
  validIdentities,
  muted,
}: MatrixAudioRendererProps): ReactNode {
  const logger = rootLogger.getChild("[MatrixAudioRenderer]");
  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: true,
      room: livekitRoom,
    },
  )
    // Only keep audio tracks
    .filter((ref) => ref.publication.kind === Track.Kind.Audio)
    // Only keep tracks from participants that are in the validIdentities list
    .filter((ref) => {
      const isValid = validIdentities.includes(ref.participant.identity);
      if (!isValid) {
        // TODO make sure to also skip the warn logging for the local identity
        // Log that there is an invalid identity, that means that someone is publishing audio that is not expected to be in the call.
        logger.warn(
          `Audio track ${ref.participant.identity} from ${url} has no matching matrix call member`,
          `current members: ${validIdentities.join()}`,
          `track will not get rendered`,
        );
        return false;
      }
      return true;
    });

  // This component is also (in addition to the "only play audio for connected members" logic above)
  // responsible for mimicking earpiece audio on iPhones.
  // The Safari audio devices enumeration does not expose an earpiece audio device.
  // We alternatively use the audioContext pan node to only use one of the stereo channels.

  // This component does get additionally complicated because of a Safari bug.
  // (see: https://bugs.webkit.org/show_bug.cgi?id=251532
  // and the related issues: https://bugs.webkit.org/show_bug.cgi?id=237878
  // and https://bugs.webkit.org/show_bug.cgi?id=231105)
  //
  // AudioContext gets stopped if the webview gets moved into the background.
  // Once the phone is in standby audio playback will stop.
  // So we can only use the pan trick only works is the phone is not in standby.
  // If earpiece mode is not used we do not use audioContext to allow standby playback.
  // shouldUseAudioContext is set to false if stereoPan === 0 to allow standby bluetooth playback.

  const { pan: stereoPan, volume: volumeFactor } = useEarpieceAudioConfig();
  // A participant whose volume is above 100% needs WebAudio routing: the gain
  // node supports volumes above 1, whereas the volume of a plain
  // HTMLMediaElement is clamped to 1. When nobody is boosted we keep the
  // previous behavior and only use the audio context for the earpiece.
  const boosted = useBehavior(boostedParticipants$);
  const anyBoosted = validIdentities.some((id) => boosted.has(id));
  const shouldUseAudioContext = anyBoosted || stereoPan !== 0;

  // The selected output device (e.g. NVIDIA Broadcast). When audio is routed
  // through the WebAudio context for a boosted participant it would otherwise
  // play out of the context's default device, bypassing the user's chosen
  // output device and any processing applied there (e.g. noise suppression).
  const audioOutputId = useObservableEagerState(
    useMediaDevices().audioOutput.selected$,
  )?.id;
  const { controlledAudioDevices } = useUrlParams();

  // initialize the potentially used audio context.
  const [audioContext, setAudioContext] = useState<AudioContext | undefined>(
    undefined,
  );
  useEffect(() => {
    const ctx = new AudioContext();
    setAudioContext(ctx);
    return (): void => {
      void ctx.close();
    };
  }, []);
  // The AudioContext starts suspended until a user gesture; it must be running
  // for volumes above 100% (applied via the WebAudio gain node) to amplify.
  useEffect(() => {
    if (audioContext === undefined) return;
    const resume = (): void => {
      if (audioContext.state === "suspended") void audioContext.resume();
    };
    resume();
    // Browsers require a user gesture to resume an AudioContext, so retry on
    // any interaction.
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    document.addEventListener("touchstart", resume);
    return (): void => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("touchstart", resume);
    };
  }, [audioContext]);
  const audioNodes = useMemo(
    () => ({
      gain: audioContext?.createGain(),
      pan: audioContext?.createStereoPanner(),
    }),
    [audioContext],
  );

  // Route the audio context to the selected output device so boosted audio
  // doesn't bypass it (e.g. NVIDIA Broadcast noise suppression). Mirrors the
  // sink handling in useAudioContext.tsx.
  useEffect(() => {
    if (
      audioContext &&
      "setSinkId" in audioContext &&
      !controlledAudioDevices
    ) {
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
      // @ts-expect-error - setSinkId doesn't exist yet in types, maybe because it's not supported everywhere.
      audioContext.setSinkId(audioOutputId).catch((ex) => {
        logger.warn("Unable to change sink for audio context", ex);
      });
    }
  }, [audioContext, audioOutputId, controlledAudioDevices, logger]);

  // Simple effects to update the gain and pan node based on the props
  useEffect(() => {
    if (audioNodes.pan) audioNodes.pan.pan.value = stereoPan;
  }, [audioNodes.pan, stereoPan]);
  useEffect(() => {
    if (audioNodes.gain) audioNodes.gain.gain.value = volumeFactor;
  }, [audioNodes.gain, volumeFactor]);

  return (
    // We add all audio elements into one <div> for the browser developer tool experience/tidyness.
    <div style={{ display: "none" }}>
      {tracks.map((trackRef) => (
        <AudioTrackWithAudioNodes
          key={getTrackReferenceId(trackRef)}
          trackRef={trackRef}
          muted={muted}
          audioContext={shouldUseAudioContext ? audioContext : undefined}
          audioNodes={audioNodes}
        />
      ))}
    </div>
  );
}

interface StereoPanAudioTrackProps {
  muted?: boolean;
  audioContext?: AudioContext;
  audioNodes: {
    gain?: GainNode;
    pan?: StereoPannerNode;
  };
}

/**
 * This wraps `livekit.AudioTrack` to allow adding audio nodes to a track.
 * It main purpose is to remount the AudioTrack component when switching from
 * audioContext to normal audio playback.
 * As of now the AudioTrack component does not support adding audio nodes while being mounted.
 * @param props The component props
 * @param props.trackRef The track reference
 * @param props.muted If the track should be muted
 * @param props.audioContext The audio context to use
 * @param props.audioNodes The audio nodes to use
 * @returns
 */
function AudioTrackWithAudioNodes({
  trackRef,
  muted,
  audioContext,
  audioNodes,
  ...props
}: StereoPanAudioTrackProps &
  AudioTrackProps &
  React.RefAttributes<HTMLAudioElement>): ReactNode {
  // This is used to unmount/remount the AudioTrack component.
  // Mounting needs to happen after the audioContext is set.
  // (adding the audio context when already mounted did not work outside strict mode)
  const mediaStream = trackRef?.publication.track?.mediaStream;
  const [trackReady, setTrackReady] = useReactiveState(
    () => false,
    // We want the track to reset when the audio context becomes available,
    // and when the underlying media stream changes (e.g. on encryption
    // renegotiation, where the WebAudio source node would otherwise stay
    // bound to the old stream).
    [audioContext && audioNodes, mediaStream],
  );

  useEffect(() => {
    if (!trackRef || trackReady) return;
    const track = trackRef.publication.track as RemoteAudioTrack;
    const useContext = audioContext && audioNodes.gain && audioNodes.pan;
    track.setAudioContext(useContext ? audioContext : undefined);
    track.setWebAudioPlugins(
      useContext ? [audioNodes.gain!, audioNodes.pan!] : [],
    );
    setTrackReady(true);
    controls.setPlaybackStarted();
  }, [audioContext, audioNodes, setTrackReady, trackReady, trackRef]);

  return (
    trackReady && <AudioTrack trackRef={trackRef} muted={muted} {...props} />
  );
}
