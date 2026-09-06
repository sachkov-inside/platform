import { type Broadcast, stateLabels } from "../model/broadcasts";
import styles from "./broadcasts.module.css";

export function BroadcastStatus({
  state,
}: {
  readonly state: Broadcast["state"];
}) {
  return (
    <span className={styles.badge} data-state={state}>
      {stateLabels[state]}
    </span>
  );
}
