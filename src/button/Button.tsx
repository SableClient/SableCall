/*
Copyright 2022-2024 New Vector Ltd.
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/
import { type ComponentPropsWithoutRef, type FC } from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";
import {
  Button as CpdButton,
  IconButton,
  Tooltip,
} from "@vector-im/compound-web";
import {
  Microphone,
  MicrophoneSlash,
  Spinner,
  VideoCamera,
  VideoCameraSlash,
  PhoneDisconnect,
  MonitorArrowUp,
} from "@phosphor-icons/react";
import {
  DotsThreeOutlineVertical,
  DotsThreeOutline,
  SpeakerHigh,
  SpeakerSlash,
} from "@phosphor-icons/react";

import styles from "./Button.module.css";
import callFooterStyles from "../components/CallFooter.module.css";
import { platform } from "../Platform";

interface MicButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  busy?: boolean;
  size?: "md" | "lg";
}

export const MicButton: FC<MicButtonProps> = ({ enabled, busy, ...props }) => {
  const { t } = useTranslation();
  const Icon = busy
    ? Spinner
    : enabled
      ? (p: any) => <Microphone {...p} />
      : (p: any) => <MicrophoneSlash weight="fill" {...p} />;
  const label = enabled
    ? t("mute_microphone_button_label")
    : t("unmute_microphone_button_label");

  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={Icon}
        kind={enabled ? "secondary" : "primary"}
        role="switch"
        aria-checked={enabled}
        {...props}
        aria-busy={busy}
        className={classNames(props.className, {
          [styles.rotate]: !!busy,
        })}
        disabled={props.disabled || busy}
      />
    </Tooltip>
  );
};

interface VideoButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  busy?: boolean;
  size?: "md" | "lg";
}

export const VideoButton: FC<VideoButtonProps> = ({
  enabled,
  busy,
  ...props
}) => {
  const { t } = useTranslation();
  const Icon = busy
    ? Spinner
    : enabled
      ? (p: any) => <VideoCamera {...p} />
      : (p: any) => <VideoCameraSlash weight="fill" {...p} />;
  const label = enabled
    ? t("stop_video_button_label")
    : t("start_video_button_label");

  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={Icon}
        kind={enabled ? "secondary" : "primary"}
        role="switch"
        aria-checked={enabled}
        {...props}
        aria-busy={busy}
        className={classNames(props.className, {
          [styles.rotate]: !!busy,
        })}
        disabled={props.disabled || busy}
      />
    </Tooltip>
  );
};

interface ShareScreenButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  size: "md" | "lg";
}

export const ShareScreenButton: FC<ShareScreenButtonProps> = ({
  enabled,
  ...props
}) => {
  const { t } = useTranslation();
  const label = enabled
    ? t("stop_screenshare_button_label")
    : t("screenshare_button_label");

  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        Icon={MonitorArrowUp}
        kind={enabled ? "primary" : "secondary"}
        role="switch"
        aria-checked={enabled}
        {...props}
      />
    </Tooltip>
  );
};

interface EndCallButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
}

export const EndCallButton: FC<EndCallButtonProps> = ({
  className,
  ...props
}) => {
  const { t } = useTranslation();

  return (
    <Tooltip label={t("hangup_button_label")}>
      <CpdButton
        className={classNames(className, styles.endCall)}
        iconOnly
        Icon={PhoneDisconnect}
        destructive
        {...props}
      />
    </Tooltip>
  );
};

interface LoudspeakerButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
  loudspeakerModeEnabled: boolean;
}
export const LoudspeakerButton: FC<LoudspeakerButtonProps> = ({
  loudspeakerModeEnabled,
  ...props
}) => {
  const { t } = useTranslation();
  // if the target is the earpice, we are currently in loudspeaker mode.
  const label = loudspeakerModeEnabled
    ? t("settings.devices.loudspeaker")
    : t("settings.devices.handset");
  return (
    <Tooltip label={label}>
      <CpdButton
        iconOnly
        children={
          loudspeakerModeEnabled ? (
            <SpeakerHigh aria-hidden />
          ) : (
            <SpeakerSlash weight="fill" aria-hidden />
          )
        }
        {...props}
        kind={loudspeakerModeEnabled ? "secondary" : "primary"}
        aria-checked={loudspeakerModeEnabled}
      />
    </Tooltip>
  );
};

function classNamesForScreenWidth(
  className?: string,
  forScreenWidth?: "wide" | "narrow",
): string {
  return classNames(className, {
    [callFooterStyles.settingsOnlyShowWide]: forScreenWidth === "wide",
    [callFooterStyles.settingsOnlyShowNarrow]: forScreenWidth === "narrow",
  });
}

interface SettingsIconButtonProps extends ComponentPropsWithoutRef<"button"> {
  /** If this buttons should be setup to be used in the app bar */
  showForScreenWidth?: "wide" | "narrow";
  kind?: "secondary" | "primary";
}
export const SettingsIconButton: FC<SettingsIconButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t("common.settings")}>
      <IconButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        {...props}
      >
        <DotsThreeOutlineVertical
          aria-hidden
          style={{ transform: "scale(0.75)", transformOrigin: "center" }}
        />
      </IconButton>
    </Tooltip>
  );
};

interface SettingsButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: "md" | "lg";
  /** If this buttons should be setup to be used in the app bar */
  showForScreenWidth?: "wide" | "narrow";
}
export const SettingsButton: FC<SettingsButtonProps> = ({
  showForScreenWidth,
  className,
  ...props
}) => {
  const { t } = useTranslation();
  return (
    <Tooltip label={t("common.settings")}>
      <CpdButton
        className={classNamesForScreenWidth(className, showForScreenWidth)}
        iconOnly
        Icon={(p: any) => {
          const IconComp =
            platform === "android"
              ? DotsThreeOutlineVertical
              : DotsThreeOutline;
          return (
            <IconComp
              {...p}
              style={{ transform: "scale(0.75)", transformOrigin: "center" }}
            />
          );
        }}
        kind={"secondary"}
        {...props}
      />
    </Tooltip>
  );
};
