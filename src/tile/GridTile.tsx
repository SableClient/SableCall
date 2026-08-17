/*
Copyright 2022-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  type ComponentProps,
  type FC,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type animated } from "@react-spring/web";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  User,
  SpeakerSlash,
  SpeakerHigh,
  ArrowsClockwise,
  Microphone,
  MicrophoneSlash,
  DotsThreeOutline,
  Eye,
  EyeSlash,
  Monitor,
  Play,
} from "@phosphor-icons/react";
import {
  ContextMenu,
  MenuItem,
  ToggleMenuItem,
  Menu,
  Text,
} from "@vector-im/compound-web";
import {
  ExpandIcon,
  CollapseIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";
import { useObservableEagerState } from "observable-hooks";

import styles from "./GridTile.module.css";
import { Slider } from "../Slider";
import { MAX_PLAYBACK_VOLUME } from "../state/VolumeControls";
import { MediaView } from "./MediaView";
import { useLatest } from "../useLatest";
import { type GridTileViewModel } from "../state/TileViewModel";
import { useMergedRefs } from "../useMergedRefs";
import { useReactionsSender } from "../reactions/useReactionsSender";
import { useBehavior } from "../useBehavior";
import { type LocalUserMediaViewModel } from "../state/media/LocalUserMediaViewModel";
import { type RemoteUserMediaViewModel } from "../state/media/RemoteUserMediaViewModel";
import { type UserMediaViewModel } from "../state/media/UserMediaViewModel";
import { type ScreenShareViewModel } from "../state/media/ScreenShareViewModel";
import { type RemoteScreenShareViewModel } from "../state/media/RemoteScreenShareViewModel";
import { type RingingMediaViewModel } from "../state/media/RingingMediaViewModel";
import { constant, type Behavior } from "../state/Behavior";
import { RingingStatus } from "./RingingStatus";

interface TileProps {
  ref?: Ref<HTMLDivElement>;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  targetWidth: number;
  targetHeight: number;
  displayName: string;
  mxcAvatarUrl: string | undefined;
  showNameTags: boolean;
  focusable: boolean;
}

interface RingingMediaTileProps extends TileProps {
  vm: RingingMediaViewModel;
  showStatus: boolean;
}

const RingingMediaTile: FC<RingingMediaTileProps> = ({
  vm,
  showStatus,
  className,
  ...props
}) => {
  return (
    <MediaView
      className={classNames(className, styles.tile)}
      video={undefined}
      userId={vm.userId}
      unencryptedWarning={false}
      status={
        showStatus && (
          <Text as="span" size="sm" weight="medium">
            <RingingStatus vm={vm} />
          </Text>
        )
      }
      avatarStyle="translucent"
      videoEnabled={false}
      videoFit="cover"
      mirror={false}
      {...props}
    />
  );
};

interface UserMediaTileProps extends TileProps {
  vm: UserMediaViewModel;
  showSpeakingIndicators: boolean;
  mirror: boolean;
  playbackMuted: boolean;
  waitingForMedia?: boolean;
  primaryButton?: ReactNode;
  menuStart?: ReactNode;
  menuEnd?: ReactNode;
  focusUrl: string | undefined;
}

const UserMediaTile: FC<UserMediaTileProps> = ({
  ref,
  vm,
  showSpeakingIndicators,
  playbackMuted,
  waitingForMedia,
  primaryButton,
  menuStart,
  menuEnd,
  className,
  focusUrl,
  displayName,
  mxcAvatarUrl,
  focusable,
  targetWidth,
  targetHeight,
  ...props
}) => {
  const { toggleRaisedHand } = useReactionsSender();
  const { t } = useTranslation();
  const video = useBehavior(vm.video$);
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const audioStreamStats = useObservableEagerState<
    RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats | undefined
  >(vm.audioStreamStats$);
  const videoStreamStats = useObservableEagerState<
    RTCInboundRtpStreamStats | RTCOutboundRtpStreamStats | undefined
  >(vm.videoStreamStats$);
  const audioEnabled = useBehavior(vm.audioEnabled$);
  const videoEnabled = useBehavior(vm.videoEnabled$);
  const speaking = useBehavior(vm.speaking$);
  const videoFit = useBehavior(vm.videoFit$);

  const rtcBackendIdentity = vm.rtcBackendIdentity;
  const handRaised = useBehavior(vm.handRaised$);
  const reaction = useBehavior(vm.reaction$);

  // Whenever bounds change, inform the viewModel
  useEffect(() => {
    if (targetWidth > 0 && targetHeight > 0) {
      vm.setTargetDimensions(targetWidth, targetHeight);
    }
  }, [targetWidth, targetHeight, vm]);

  const AudioIcon = playbackMuted
    ? (props: any) => <SpeakerSlash weight="fill" {...props} />
    : audioEnabled
      ? (props: any) => <Microphone weight="fill" {...props} />
      : (props: any) => <MicrophoneSlash weight="fill" {...props} />;
  const audioIconLabel = playbackMuted
    ? t("video_tile.muted_for_me")
    : audioEnabled
      ? t("microphone_on")
      : t("microphone_off");

  const [menuOpen, setMenuOpen] = useState(false);
  const menu = (
    <>
      {menuStart}
      {/*
       No additional menu item (used to be the manual fit to frame.
       Placeholder for future menu items that should be placed here.
       */}
      {menuEnd}
    </>
  );

  const raisedHandOnClick = vm.local
    ? (): void => void toggleRaisedHand()
    : undefined;

  const showSpeaking = showSpeakingIndicators && speaking;

  const tile = (
    <MediaView
      ref={ref}
      video={video}
      userId={vm.userId}
      unencryptedWarning={unencryptedWarning}
      videoEnabled={videoEnabled}
      videoFit={videoFit}
      className={classNames(className, styles.tile, {
        [styles.speaking]: showSpeaking,
        [styles.handRaised]: !showSpeaking && handRaised,
      })}
      nameTagLeadingIcon={
        playbackMuted ? (
          <SpeakerSlash
            width={20}
            height={20}
            aria-label={audioIconLabel}
            className={styles.muteIcon}
          />
        ) : (
          <AudioIcon
            width={20}
            height={20}
            aria-label={audioIconLabel}
            data-muted={!audioEnabled}
            className={styles.muteIcon}
          />
        )
      }
      displayName={displayName}
      mxcAvatarUrl={mxcAvatarUrl}
      focusable={focusable}
      primaryButton={
        primaryButton ?? (
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title={displayName}
            trigger={
              <button
                aria-label={t("common.options")}
                tabIndex={focusable ? undefined : -1}
              >
                <DotsThreeOutline
                  aria-hidden
                  width={18}
                  height={18}
                  style={{
                    transform: "scale(0.75)",
                    transformOrigin: "center",
                  }}
                />
              </button>
            }
            side="left"
            align="start"
          >
            {menu}
          </Menu>
        )
      }
      raisedHandTime={handRaised ?? undefined}
      currentReaction={reaction ?? undefined}
      raisedHandOnClick={raisedHandOnClick}
      waitingForMedia={waitingForMedia}
      focusUrl={focusUrl}
      audioStreamStats={audioStreamStats}
      videoStreamStats={videoStreamStats}
      rtcBackendIdentity={rtcBackendIdentity}
      targetWidth={targetWidth}
      targetHeight={targetHeight}
      {...props}
    />
  );

  return (
    <ContextMenu title={displayName} trigger={tile} hasAccessibleAlternative>
      {menu}
    </ContextMenu>
  );
};

UserMediaTile.displayName = "UserMediaTile";

interface LocalUserMediaTileProps extends TileProps {
  vm: LocalUserMediaViewModel;
  showSpeakingIndicators: boolean;
  onOpenProfile: (() => void) | null;
}

const LocalUserMediaTile: FC<LocalUserMediaTileProps> = ({
  ref,
  vm,
  onOpenProfile,
  focusable,
  ...props
}) => {
  const { t } = useTranslation();
  const mirror = useBehavior(vm.mirror$);
  const alwaysShow = useBehavior(vm.alwaysShow$);
  const switchCamera = useBehavior(vm.switchCamera$);
  const focusUrl = useBehavior(vm.focusUrl$);

  const latestAlwaysShow = useLatest(alwaysShow);
  const onSelectAlwaysShow = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.setAlwaysShow(!latestAlwaysShow.current);
    },
    [vm, latestAlwaysShow],
  );

  return (
    <UserMediaTile
      ref={ref}
      vm={vm}
      playbackMuted={false}
      mirror={mirror}
      primaryButton={
        switchCamera === null ? undefined : (
          <button
            className={styles.switchCamera}
            aria-label={t("switch_camera")}
            onClick={switchCamera}
            tabIndex={focusable ? undefined : -1}
          >
            <ArrowsClockwise weight="fill" width={20} height={20} aria-hidden />
          </button>
        )
      }
      menuStart={
        <ToggleMenuItem
          Icon={Eye}
          label={t("video_tile.always_show")}
          checked={alwaysShow}
          onSelect={onSelectAlwaysShow}
        />
      }
      menuEnd={
        onOpenProfile && (
          <MenuItem
            Icon={User}
            label={t("common.profile")}
            onSelect={onOpenProfile}
          />
        )
      }
      focusable={focusable}
      focusUrl={focusUrl}
      {...props}
    />
  );
};

LocalUserMediaTile.displayName = "LocalUserMediaTile";

interface RemoteUserMediaTileProps extends TileProps {
  vm: RemoteUserMediaViewModel;
  showSpeakingIndicators: boolean;
}

const RemoteUserMediaTile: FC<RemoteUserMediaTileProps> = ({
  ref,
  vm,
  ...props
}) => {
  const { t } = useTranslation();
  const waitingForMedia = useBehavior(vm.waitingForMedia$);
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const playbackVolume = useBehavior(vm.playbackVolume$);
  const focusUrl = useBehavior(vm.focusUrl$);

  const onSelectMute = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.togglePlaybackMuted();
    },
    [vm],
  );

  const VolumeIcon = playbackMuted ? SpeakerSlash : SpeakerHigh;

  return (
    <UserMediaTile
      ref={ref}
      vm={vm}
      waitingForMedia={waitingForMedia}
      playbackMuted={playbackMuted}
      mirror={false}
      menuStart={
        <>
          <ToggleMenuItem
            Icon={MicrophoneSlash}
            label={t("video_tile.mute_for_me")}
            checked={playbackMuted}
            onSelect={onSelectMute}
          />
          {/* TODO: Figure out how to make this slider keyboard accessible */}
          <MenuItem as="div" Icon={VolumeIcon} label={null} onSelect={null}>
            <Slider
              className={styles.volumeSlider}
              label={t("video_tile.volume")}
              value={playbackVolume}
              onValueChange={vm.adjustPlaybackVolume}
              onValueCommit={vm.commitPlaybackVolume}
              min={0}
              max={MAX_PLAYBACK_VOLUME}
              step={0.01}
            />
          </MenuItem>
        </>
      }
      focusUrl={focusUrl}
      {...props}
    />
  );
};

RemoteUserMediaTile.displayName = "RemoteUserMediaTile";

interface ScreenShareTileProps extends TileProps {
  vm: ScreenShareViewModel;
  /**
   * The currently focused (maximised) stream, used to decide whether this tile
   * shows a "maximise" or "restore" button.
   */
  focusedStream$?: Behavior<ScreenShareViewModel | null>;
  /**
   * Focuses (maximises) the given stream so it fills the grid and hides every
   * other tile, or unfocuses when passed null.
   */
  onToggleFocusedStream?: (vm: ScreenShareViewModel | null) => void;
}

/**
 * New Tile for screen sharing participants.
 */
const ScreenShareTile: FC<ScreenShareTileProps> = (props) => {
  const { vm, ...rest } = props;
  return vm.local ? (
    <ScreenShareTileContent vm={vm} {...rest} videoEnabled={true} />
  ) : (
    <RemoteScreenShareTileContent vm={vm} {...rest} />
  );
};

const RemoteScreenShareTileContent: FC<
  Omit<ScreenShareTileProps, "vm"> & { vm: RemoteScreenShareViewModel }
> = ({ vm, ...props }) => {
  const { t } = useTranslation();
  const videoEnabled = useBehavior(vm.videoEnabled$);
  const playbackMuted = useBehavior(vm.playbackMuted$);
  const playbackVolume = useBehavior(vm.playbackVolume$);
  const watching = useBehavior(vm.watching$);

  const onSelectMute = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.togglePlaybackMuted();
    },
    [vm],
  );

  const onSelectWatching = useCallback(
    (e: Event) => {
      e.preventDefault();
      vm.setWatching(!watching);
    },
    [vm, watching],
  );

  const VolumeIcon = playbackMuted ? SpeakerSlash : SpeakerHigh;

  return (
    <ScreenShareTileContent
      vm={vm}
      videoEnabled={videoEnabled}
      {...props}
      menu={
        <>
          <ToggleMenuItem
            Icon={watching ? EyeSlash : Play}
            label={
              watching
                ? t("video_tile.stop_watching")
                : t("video_tile.watch_stream")
            }
            checked={!watching}
            onSelect={onSelectWatching}
          />
          <ToggleMenuItem
            Icon={MicrophoneSlash}
            label={t("video_tile.mute_for_me")}
            checked={playbackMuted}
            onSelect={onSelectMute}
          />
          {/* TODO: Figure out how to make this slider keyboard accessible */}
          <MenuItem as="div" Icon={VolumeIcon} label={null} onSelect={null}>
            <Slider
              className={styles.volumeSlider}
              label={t("video_tile.screen_share_volume")}
              value={playbackVolume}
              onValueChange={vm.adjustPlaybackVolume}
              onValueCommit={vm.commitPlaybackVolume}
              min={0}
              max={MAX_PLAYBACK_VOLUME}
              step={0.01}
            />
          </MenuItem>
        </>
      }
    />
  );
};

RemoteScreenShareTileContent.displayName = "RemoteScreenShareTileContent";

interface ScreenShareTileContentProps extends ScreenShareTileProps {
  videoEnabled: boolean;
  menu?: ReactNode;
}

const ScreenShareTileContent: FC<ScreenShareTileContentProps> = ({
  ref,
  vm,
  videoEnabled,
  menu,
  focusedStream$,
  onToggleFocusedStream,
  className,
  focusable,
  targetWidth,
  targetHeight,
  displayName,
  mxcAvatarUrl,
  ...props
}) => {
  const { t } = useTranslation();
  const video = useBehavior(vm.video$);
  const unencryptedWarning = useBehavior(vm.unencryptedWarning$);
  const focusUrl = useBehavior(vm.focusUrl$);
  const watching = useBehavior(vm.watching$);
  const [menuOpen, setMenuOpen] = useState(false);
  const focusedStream = useBehavior(focusedStream$ ?? constant(null));
  const isFocused = focusedStream?.id === vm.id;

  // A ref to the tile root so we can freeze the video element when the user
  // stops watching the stream.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const mergedRef = useMergedRefs(contentRef, ref);

  const [frozenFrame, setFrozenFrame] = useState<string | null>(null);

  useEffect(() => {
    if (watching) {
      setFrozenFrame(null);
      return;
    }
    const video = contentRef.current?.querySelector("video");
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      setFrozenFrame(canvas.toDataURL());
    } else {
      setFrozenFrame(null);
    }
  }, [watching]);

  // Freeze the video (pause it) while not watching, and resume when watching.
  // While stopped we also watch for new video elements (e.g. LiveKit
  // re-attaching) and pause those too.
  useEffect(() => {
    const root = contentRef.current;
    if (root === null) return;
    const apply = (): void => {
      root.querySelectorAll("video").forEach((v) => {
        if (watching) void v.play().catch(() => {});
        else v.pause();
      });
    };
    apply();
    if (watching) return;
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return (): void => observer.disconnect();
  }, [watching]);

  const FocusIcon = isFocused ? CollapseIcon : ExpandIcon;

  const tile = (
    <MediaView
      ref={mergedRef}
      video={video}
      streamOverlay={
        watching ? undefined : (
          <div className={styles.streamOverlayInner}>
            {frozenFrame !== null ? (
              <img
                className={styles.frozenFrame}
                src={frozenFrame}
                alt=""
                aria-hidden
              />
            ) : (
              <div className={styles.streamOverlayScrim} />
            )}
            <button
              className={styles.watchStream}
              aria-label={t("video_tile.watch_stream")}
              onClick={(): void => {
                vm.setWatching(true);
                // Resume playback within the click gesture.
                contentRef.current
                  ?.querySelectorAll("video")
                  .forEach((v) => void v.play().catch(() => {}));
              }}
              tabIndex={focusable ? undefined : -1}
            >
              <Play aria-hidden width={20} height={20} />
              {t("video_tile.watch_stream")}
            </button>
          </div>
        )
      }
      userId={vm.userId}
      unencryptedWarning={unencryptedWarning}
      videoEnabled={videoEnabled}
      videoFit="contain"
      mirror={false}
      className={classNames(className, styles.tile)}
      nameTagLeadingIcon={<Monitor width={20} height={20} aria-hidden />}
      displayName={displayName}
      mxcAvatarUrl={mxcAvatarUrl}
      focusable={focusable}
      primaryButton={
        onToggleFocusedStream === undefined &&
        menu === undefined ? undefined : (
          <>
            {onToggleFocusedStream !== undefined && (
              <button
                className={styles.maximise}
                aria-label={
                  isFocused ? t("video_tile.collapse") : t("video_tile.expand")
                }
                data-enabled="true"
                onClick={(): void =>
                  onToggleFocusedStream(isFocused ? null : vm)
                }
                tabIndex={focusable ? undefined : -1}
              >
                <FocusIcon aria-hidden width={20} height={20} />
              </button>
            )}
            {menu !== undefined && (
              <Menu
                open={menuOpen}
                onOpenChange={setMenuOpen}
                title={displayName}
                trigger={
                  <button
                    aria-label={t("common.options")}
                    tabIndex={focusable ? undefined : -1}
                  >
                    <DotsThreeOutline
                      aria-hidden
                      width={18}
                      height={18}
                      style={{
                        transform: "scale(0.75)",
                        transformOrigin: "center",
                      }}
                    />
                  </button>
                }
                side="left"
                align="start"
              >
                {menu}
              </Menu>
            )}
          </>
        )
      }
      focusUrl={focusUrl}
      targetWidth={targetWidth}
      targetHeight={targetHeight}
      {...props}
    />
  );

  return menu === undefined ? (
    tile
  ) : (
    <ContextMenu title={displayName} trigger={tile} hasAccessibleAlternative>
      {menu}
    </ContextMenu>
  );
};

ScreenShareTileContent.displayName = "ScreenShareTileContent";

interface GridTileProps {
  ref?: Ref<HTMLDivElement>;
  vm: GridTileViewModel;
  onOpenProfile: (() => void) | null;
  targetWidth: number;
  targetHeight: number;
  className?: string;
  style?: ComponentProps<typeof animated.div>["style"];
  showSpeakingIndicators: boolean;
  showNameTags: boolean;
  showRingingStatus: boolean;
  showOutline: boolean;
  focusable: boolean;
  focusedStream$?: Behavior<ScreenShareViewModel | null>;
  onToggleFocusedStream?: (vm: ScreenShareViewModel | null) => void;
}

export const GridTile: FC<GridTileProps> = ({
  ref: theirRef,
  vm,
  showSpeakingIndicators,
  showRingingStatus,
  showOutline,
  onOpenProfile,
  focusedStream$,
  onToggleFocusedStream,
  className,
  ...props
}) => {
  const ourRef = useRef<HTMLDivElement | null>(null);
  const ref = useMergedRefs(ourRef, theirRef);
  const media = useBehavior(vm.media$);
  const displayName = useBehavior(media.displayName$);
  const mxcAvatarUrl = useBehavior(media.mxcAvatarUrl$);

  if (media.type === "ringing") {
    return (
      <RingingMediaTile
        ref={ref}
        vm={media}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        showStatus={showRingingStatus}
        className={classNames(className, { [styles.outline]: showOutline })}
        {...props}
      />
    );
  } else if (media.type === "screen share") {
    return (
      <ScreenShareTile
        ref={ref}
        vm={media}
        focusedStream$={focusedStream$}
        onToggleFocusedStream={onToggleFocusedStream}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        {...props}
      />
    );
  } else if (media.local) {
    return (
      <LocalUserMediaTile
        ref={ref}
        vm={media}
        showSpeakingIndicators={showSpeakingIndicators}
        onOpenProfile={onOpenProfile}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        {...props}
      />
    );
  } else {
    return (
      <RemoteUserMediaTile
        ref={ref}
        vm={media}
        showSpeakingIndicators={showSpeakingIndicators}
        displayName={displayName}
        mxcAvatarUrl={mxcAvatarUrl}
        className={classNames(className, { [styles.outline]: showOutline })}
        {...props}
      />
    );
  }
};

GridTile.displayName = "GridTile";
