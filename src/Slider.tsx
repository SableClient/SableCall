/*
Copyright 2023, 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type FC, useCallback } from "react";
import { Root, Track, Range, Thumb } from "@radix-ui/react-slider";
import classNames from "classnames";
import { Tooltip } from "@vector-im/compound-web";

import styles from "./Slider.module.css";

interface Props {
  className?: string;
  label: string;
  value: number;
  /**
   * Event handler called when the value changes during an interaction.
   */
  onValueChange: (value: number) => void;
  /**
   * Event handler called when the value changes at the end of an interaction.
   * Useful when you only need to capture a final value to update a backend
   * service, or when you want to remember the last value that the user
   * "committed" to.
   */
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  /**
   * Custom formatter for the tooltip label. If not provided, the value is
   * displayed as a percentage.
   */
  tooltipFormatter?: (value: number) => string;
  /**
   * Live input level to render as a meter inside the track, as a fraction
   * (0-1) of the slider's range. The meter is highlighted while the level
   * exceeds the slider's current value.
   */
  level?: number;
}

/**
 * A slider control allowing a value to be selected from a range.
 */
export const Slider: FC<Props> = ({
  className,
  label,
  value,
  onValueChange: onValueChangeProp,
  onValueCommit: onValueCommitProp,
  min,
  max,
  step,
  disabled,
  tooltipFormatter,
  level,
}) => {
  const onValueChange = useCallback(
    ([v]: number[]) => onValueChangeProp(v),
    [onValueChangeProp],
  );
  const onValueCommit = useCallback(
    ([v]: number[]) => onValueCommitProp?.(v),
    [onValueCommitProp],
  );
  const levelAboveValue =
    level !== undefined && max > min && level >= (value - min) / (max - min);

  return (
    <Root
      className={classNames(className, styles.slider)}
      value={[value]}
      onValueChange={onValueChange}
      onValueCommit={onValueCommit}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <Track className={styles.track}>
        <Range className={styles.highlight} />
        {level !== undefined && (
          <div
            data-testid="slider-level-meter"
            className={classNames(styles.level, {
              [styles.levelAbove]: levelAboveValue,
            })}
            style={{ inlineSize: `${Math.max(0, Math.min(1, level)) * 100}%` }}
          />
        )}
      </Track>
      {/* Note: This is expected not to be visible on mobile.*/}
      <Tooltip
        placement="top"
        label={
          tooltipFormatter
            ? tooltipFormatter(value)
            : Math.round(value * 100).toString() + "%"
        }
      >
        <Thumb className={styles.handle} aria-label={label} />
      </Tooltip>
    </Root>
  );
};
