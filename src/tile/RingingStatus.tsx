/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC } from "react";
import { VideoCamera, Phone, PhoneDisconnect } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { type RingingMediaViewModel } from "../state/media/RingingMediaViewModel";
import { useBehavior } from "../useBehavior";

interface Props {
  vm: RingingMediaViewModel;
}

export const RingingStatus: FC<Props> = ({ vm }) => {
  const { t } = useTranslation();
  const pickupState = useBehavior(vm.pickupState$);
  const Icon =
    pickupState === "ringing"
      ? vm.intent === "video"
        ? VideoCamera
        : Phone
      : PhoneDisconnect;

  return (
    <>
      <Icon weight="fill" aria-hidden />
      {pickupState === "ringing"
        ? t("video_tile.calling")
        : t("video_tile.call_ended")}
    </>
  );
};
