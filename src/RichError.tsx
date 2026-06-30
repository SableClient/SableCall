/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { useTranslation } from "react-i18next";
import { ArrowSquareOut } from "@phosphor-icons/react";

import type { FC, ReactNode } from "react";
import { ErrorView } from "./ErrorView";
import { widget } from "./widget.ts";

/**
 * An error consisting of a terse message to be logged to the console and a
 * richer message to be shown to the user, as a full-screen page.
 */
export class RichError extends Error {
  public constructor(
    message: string,
    /**
     * The pretty, more helpful message to be shown on the error screen.
     */
    public readonly richMessage: ReactNode,
  ) {
    super(message);
  }
}

const OpenElsewhere: FC = () => {
  const { t } = useTranslation();

  return (
    <ErrorView
      widget={widget}
      Icon={ArrowSquareOut}
      title={t("error.open_elsewhere")}
    >
      <p>
        {t("error.open_elsewhere_description", {
          brand: import.meta.env.VITE_PRODUCT_NAME || "Element Call",
        })}
      </p>
    </ErrorView>
  );
};

export class OpenElsewhereError extends RichError {
  public constructor() {
    super("App opened in another tab", <OpenElsewhere />);
  }
}
