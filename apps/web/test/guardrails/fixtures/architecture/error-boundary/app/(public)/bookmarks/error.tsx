"use client";

import { useRenderErrorReport } from "@/features/client-telemetry";

type Props = { readonly error: Error; readonly reset: () => void };

/** `reset`, разобранный из свойств в теле, — тот же `reset` границы. */
const BookmarksError = (props: Props) => {
  const { error, reset } = props;
  useRenderErrorReport("public", error);
  return <button onClick={reset}>Повторить</button>;
};

export default BookmarksError;
