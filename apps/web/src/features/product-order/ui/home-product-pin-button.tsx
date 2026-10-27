import { Pin, PinOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { HomePinControls } from "../model/home-pin";

export function HomeProductPinButton({
  productId,
  productName,
  archived,
  controls,
}: {
  readonly productId: string;
  readonly productName: string;
  readonly archived: boolean;
  readonly controls: HomePinControls;
}) {
  const pinned = controls.pin?.productId === productId;
  const label = pinned
    ? `Снять закреп «${productName}»`
    : `Закрепить «${productName}» на главной`;
  return (
    <Button
      aria-label={label}
      aria-pressed={pinned}
      title={archived && !pinned ? "Сначала верните продукт из архива" : label}
      className={
        pinned
          ? "size-11 shrink-0 text-action"
          : "size-11 shrink-0 text-muted-foreground"
      }
      disabled={
        controls.pin === null || controls.pending || (archived && !pinned)
      }
      onClick={() => {
        controls.onChange(pinned ? null : productId);
      }}
      size="icon"
      type="button"
      variant={pinned ? "secondary" : "ghost"}
    >
      {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
    </Button>
  );
}
