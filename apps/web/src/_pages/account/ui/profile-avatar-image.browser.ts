export interface DecodedAvatarImage {
  readonly file: File;
  readonly height: number;
  readonly url: string;
  readonly width: number;
}

export function createAvatarImageReader({
  onDecoded,
  onUnreadable,
}: {
  readonly onDecoded: (image: DecodedAvatarImage) => void;
  readonly onUnreadable: () => void;
}) {
  let active = true;
  let pending: {
    readonly probe: HTMLImageElement;
    readonly url: string;
  } | null = null;

  function discardPending() {
    if (pending === null) return;
    const { probe, url } = pending;
    pending = null;
    probe.onload = null;
    probe.onerror = null;
    probe.removeAttribute("src");
    URL.revokeObjectURL(url);
  }

  return {
    read(file: File) {
      if (!active) return;
      discardPending();
      const url = URL.createObjectURL(file);
      const probe = new Image();
      const selection = { probe, url };
      pending = selection;
      probe.onload = () => {
        if (pending !== selection) return;
        const image = {
          file,
          height: probe.naturalHeight,
          url,
          width: probe.naturalWidth,
        };
        pending = null;
        probe.onload = null;
        probe.onerror = null;
        probe.removeAttribute("src");
        onDecoded(image);
      };
      probe.onerror = () => {
        if (pending !== selection) return;
        discardPending();
        onUnreadable();
      };
      probe.src = url;
    },
    dispose() {
      active = false;
      discardPending();
    },
  };
}
