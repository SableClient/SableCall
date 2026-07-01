/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useState, type FC, useEffect } from "react";
import {
  Button,
  Menu,
  MenuItem,
  ToggleMenuItem,
} from "@vector-im/compound-web";
import {
  Microphone,
  Spinner,
  VideoCamera,
  Check,
  CaretUp,
  CaretDown,
  Headphones,
} from "@phosphor-icons/react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import styles from "./MediaMuteAndSwitchButton.module.css";
import { MicButton, VideoButton, DeafenButton } from "../button";
import { type DeviceLabel, type AudioOutputDeviceLabel } from "../state/MediaDevices";
import { useMediaDevices } from "../MediaDevicesContext";

export interface MenuOptions {
  label: DeviceLabel | AudioOutputDeviceLabel;
  id: string;
}

export interface MediaMuteAndSwitchButtonProps {
  /** The title used in the Switcher modal. */
  title: string;
  /** If the Mute button is enabled */
  enabled?: boolean;
  /** Callback if the mute button is clicked */
  onMuteClick?: () => void;
  /** True while mute/unmute operation is syncing. */
  busy?: boolean;
  iconsAndLabels: "video" | "audio" | "audioOutput";
  /** The options available for the media device selector modal */
  options?: MenuOptions[];
  /** The option that will currently be rendered as the selected option */
  selectedOption?: string;
  videoBlurToggleClick?: () => void;
  videoBlurEnabled?: boolean;
  /**
   * For any toggle and option this method will be called.
   * So toggles need to be implemented by listening here and setting the right toggle item to `enabled`
   */
  onSelect?: (id: string) => void;
}

const BLUR_ID = "blur";

export const MediaMuteAndSwitchButton: FC<MediaMuteAndSwitchButtonProps> = ({
  title,
  enabled,
  busy,
  onMuteClick,
  iconsAndLabels,
  options,
  selectedOption,
  videoBlurEnabled,
  videoBlurToggleClick,
  onSelect,
}) => {
  const [plannedSelection, setPlannedSelection] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isBusy = busy ?? false;
  const { t } = useTranslation();
  const devices = useMediaDevices();

  useEffect(() => {
    if (menuOpen) devices.requestDeviceNames(); // No-op after the first call
  }, [menuOpen, devices]);

  let button;
  let toggles: { label: string; enabled: boolean; id: string }[] = [];
  switch (iconsAndLabels) {
    case "video":
      button = (
        <VideoButton
          enabled={enabled ?? false}
          busy={isBusy}
          onClick={(e) => {
            onMuteClick?.();
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={isBusy || onMuteClick === undefined}
          data-testid="incall_videomute"
        />
      );
      if (videoBlurToggleClick !== undefined) {
        toggles = [
          {
            label: t("action.blur_background"),
            enabled: videoBlurEnabled ?? false,
            id: BLUR_ID,
          },
        ];
      }
      break;
    case "audio":
      button = (
        <MicButton
          enabled={enabled ?? false}
          busy={isBusy}
          onClick={(e) => {
            onMuteClick?.();
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={isBusy || onMuteClick === undefined}
          data-testid="incall_mute"
        />
      );
      break;
    case "audioOutput":
      button = (
        <DeafenButton
          enabled={enabled ?? false}
          busy={isBusy}
          onClick={(e) => {
            onMuteClick?.();
            e.preventDefault();
            e.stopPropagation();
          }}
          disabled={isBusy || onMuteClick === undefined}
          data-testid="incall_deafen"
        />
      );
      break;
  }

  let IconOptions: React.ElementType;
  let optionsButtonLabel: string;
  let numberedLabel: (number: number) => string;
  switch (iconsAndLabels) {
    case "video":
      IconOptions = VideoCamera;
      optionsButtonLabel = t("settings.devices.camera");
      numberedLabel = (n): string =>
        t("settings.devices.camera_numbered", { n });
      break;
    case "audio":
      IconOptions = Microphone;
      optionsButtonLabel = t("settings.devices.microphone");
      numberedLabel = (n): string =>
        t("settings.devices.microphone_numbered", { n });
      break;
    case "audioOutput":
      IconOptions = Headphones;
      optionsButtonLabel = t("settings.devices.loudspeaker") ?? "Audio Output";
      numberedLabel = (n): string => `Speaker ${n}`;
      break;
  }

  return (
    <div
      className={classNames({
        [styles.container]: true,
        [styles.containerOpen]: menuOpen,
      })}
    >
      {/* The mute button lives inside */}
      {button}
      <Menu
        title={title}
        showTitle={true}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        side="top"
        trigger={
          <Button
            iconOnly
            className={classNames({
              [styles.menuButton]: true,
              [styles.chevronIconOpen]: menuOpen,
            })}
            Icon={menuOpen ? CaretUp : CaretDown}
            kind={"tertiary"}
            size="lg"
            aria-label={optionsButtonLabel}
          />
        }
      >
        <div className={styles.scrollableArea}>
          {options?.map(({ label, id }) => {
            let labelText: string = "";
            switch (label.type) {
              case "name":
                labelText = label.name;
                break;
              case "number":
                labelText = numberedLabel(label.number);
                break;
              case "speaker":
                labelText = t("settings.devices.loudspeaker") ?? "Speaker";
                break;
              case "earpiece":
                labelText = t("settings.devices.handset") ?? "Earpiece";
                break;
              case "default":
                labelText = label.name ? `${t("settings.devices.default", "Default")} (${label.name})` : t("settings.devices.default", "Default");
                break;
            }
            return (
              <MenuItem
                hideChevron
                className={styles.menuItem}
                label={labelText}
                Icon={
                  IconOptions ? (
                    <div className={styles.iconWrapper}>
                      <IconOptions
                        width={24}
                        height={24}
                        className={styles.itemIcon}
                      />
                    </div>
                  ) : undefined
                }
                onSelect={(e) => {
                  e.preventDefault();
                  if (id === selectedOption) return;
                  setPlannedSelection(id);
                  onSelect?.(id);
                }}
                key={id}
              >
                <div className={styles.iconWrapper}>
                  {selectedOption === id && <Check width={24} height={24} />}
                  {selectedOption !== id && plannedSelection === id && (
                    <Spinner width={24} height={24} className={styles.rotate} />
                  )}
                </div>
              </MenuItem>
            );
          })}
          {(toggles?.length ?? 0) > 0 && <hr />}
          {toggles?.map((toggle) => (
            <ToggleMenuItem
              className={styles.menuItem}
              label={toggle.label}
              onSelect={(e) => {
                videoBlurToggleClick?.();
                e.preventDefault();
              }}
              checked={toggle.enabled ?? false}
              key={toggle.id}
            />
          ))}
        </div>
      </Menu>
    </div>
  );
};
