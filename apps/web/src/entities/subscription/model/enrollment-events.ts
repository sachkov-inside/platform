const channelName = "inside.enrollments.changed";
export function announceEnrollmentChange() {
  window.dispatchEvent(new Event(channelName));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage("changed");
  channel.close();
}
export function subscribeEnrollmentChange(refresh: () => void) {
  window.addEventListener(channelName, refresh);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(channelName);
  channel?.addEventListener("message", refresh);
  return () => {
    window.removeEventListener(channelName, refresh);
    channel?.close();
  };
}
