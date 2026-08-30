"use client";

import { Flag } from "lucide-react";
import { useActionState } from "react";

import {
  initialProfileReportState,
  type ProfileReportState,
} from "@/_pages/account/model/member-profile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

type ProfileReportAction = (
  state: ProfileReportState,
  formData: FormData,
) => Promise<ProfileReportState>;

export function MemberProfileReport({
  publicProfileId,
  reportAction,
}: {
  readonly publicProfileId: string;
  readonly reportAction: ProfileReportAction;
}) {
  const [state, action, pending] = useActionState(
    reportAction,
    initialProfileReportState,
  );

  return (
    <details className="group mt-8 border-t border-border pt-5">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm font-semibold text-muted-foreground hover:text-foreground">
        <Flag aria-hidden="true" className="size-4" />
        Сообщить о тексте профиля
      </summary>
      <form action={action} className="mt-4 max-w-lg rounded-xl border border-border bg-muted/35 p-4">
        <input name="publicProfileId" type="hidden" value={publicProfileId} />
        <label className="text-sm font-semibold" htmlFor="profile-report-reason">
          Причина
        </label>
        <Select defaultValue="unsafe_content" name="reason">
          <SelectTrigger className="mt-2" id="profile-report-reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unsafe_content">
              Небезопасный или оскорбительный текст
            </SelectItem>
            <SelectItem value="impersonation">
              Выдаёт себя за другого человека
            </SelectItem>
            <SelectItem value="other">Другая причина</SelectItem>
          </SelectContent>
        </Select>
        <button
          className="mt-4 min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          disabled={pending}
          type="submit"
        >
          {pending ? "Отправляем…" : "Отправить жалобу"}
        </button>
        <p aria-live="polite" className="mt-3 text-sm text-muted-foreground">
          {state.kind === "reported"
            ? state.duplicate
              ? "Ваша жалоба уже была принята."
              : "Жалоба принята для ручной проверки."
            : state.kind === "unavailable"
              ? "Не удалось отправить жалобу. Повторите попытку позже."
              : ""}
        </p>
      </form>
    </details>
  );
}
