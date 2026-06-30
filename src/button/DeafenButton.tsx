import { type ComponentPropsWithoutRef, type FC } from "react";
import classNames from "classnames";
import {
  Button as CpdButton,
  Tooltip,
} from "@vector-im/compound-web";
import {
  SpeakerHigh,
  SpeakerSlash,
  Spinner,
} from "@phosphor-icons/react";

import styles from "./Button.module.css";

interface DeafenButtonProps extends ComponentPropsWithoutRef<"button"> {
  enabled: boolean;
  busy?: boolean;
  size?: "md" | "lg";
}

export const DeafenButton: FC<DeafenButtonProps> = ({ enabled, busy, ...props }) => {
  const Icon = busy ? Spinner : enabled ? (p: any) => <SpeakerHigh weight="fill" {...p} /> : (p: any) => <SpeakerSlash weight="fill" {...p} />;
  
  // Using generic labels for now, these can be added to i18n later if needed
  const label = enabled ? "Deafen" : "Undeafen";

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
