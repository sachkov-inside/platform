import { useEffect, useState } from "react";
import { FileText, UploadCloud } from "lucide-react";
import { sileo, Toaster } from "sileo";
import "sileo/styles.css";
import { Button } from "@/shared/ui/button";
import { DemoControls } from "./demo-controls.prototype";

type UploadState = "idle" | "waiting" | "success" | "error";
const messages = {
  idle: "Файл ещё не загружен.",
  waiting: "Загружаем файл «Шаблон технического решения.pdf»…",
  success:
    "Файл «Шаблон технического решения.pdf» загружен. Можно прикрепить к материалу.",
  error: "Загрузка прервана. Файл не сохранён. Повторите загрузку.",
};
export function Upload({ variant }: { readonly variant: number }) {
  const [state, setState] = useState<UploadState>("idle");
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 600px)").matches,
  );
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 600px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setMobile(narrow.matches);
      setReduced(motion.matches);
    };
    narrow.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    return () => {
      narrow.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);
  useEffect(() => {
    if (variant !== 1 || reduced || state === "idle") return;
    const options = {
      title:
        state === "waiting"
          ? "Загружаем файл"
          : state === "success"
            ? "Файл загружен"
            : "Не удалось загрузить",
      description: messages[state],
      duration: null,
      autopilot: false,
      fill: "var(--primary)",
      styles: {
        title: "lab-toast-title",
        description: "lab-toast-description",
      },
    };
    const id =
      state === "waiting"
        ? sileo.show({ ...options, type: "loading" })
        : state === "success"
          ? sileo.success(options)
          : sileo.error(options);
    return () => {
      sileo.dismiss(id);
    };
  }, [state, variant, reduced]);
  return (
    <>
      <DemoControls>
        <label>
          Загрузка
          <select
            aria-label="Состояние загрузки"
            value={state}
            onChange={(e) => {
              const value = e.target.value;
              const next = ["idle", "waiting", "success", "error"].find(
                (item): item is UploadState => item === value,
              );
              setState(next ?? "idle");
            }}
          >
            <option value="idle">Файл выбран</option>
            <option value="waiting">Ожидание</option>
            <option value="success">Успех</option>
            <option value="error">Ошибка</option>
          </select>
        </label>
        <span>
          {reduced ? "Уменьшенное движение: включено" : "Обычное движение"}
        </span>
      </DemoControls>
      <section className="lab-upload-surface">
        <h2>Материал · Контекст задачи</h2>
        <p className="lab-muted">
          Прикрепите шаблон, чтобы ученики могли повторить работу.
        </p>
        <div className="lab-upload-file">
          <FileText aria-hidden="true" size={32} />
          <div>
            <strong>Шаблон технического решения.pdf</strong>
            <span>PDF · 2,4 МБ · демонстрационный файл</span>
          </div>
        </div>
        <div
          className="lab-upload-result"
          role={variant === 1 && !reduced ? undefined : "status"}
          aria-live={variant === 1 && !reduced ? "off" : "polite"}
          aria-atomic="true"
        >
          <p>{messages[state]}</p>
          {state === "waiting" ? (
            <progress aria-label="Загрузка файла" />
          ) : null}
        </div>
        <div className="lab-actions">
          <Button
            disabled={state === "waiting" || state === "success"}
            onClick={() => {
              setState("waiting");
            }}
          >
            <UploadCloud aria-hidden="true" />
            {state === "error" ? "Повторить загрузку" : "Загрузить файл"}
          </Button>
          {state === "waiting" ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setState("success");
                }}
              >
                Завершить успешно
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setState("error");
                }}
              >
                Прервать с ошибкой
              </Button>
            </>
          ) : null}
          {state === "success" ? (
            <Button
              variant="outline"
              onClick={() => {
                setState("idle");
              }}
            >
              Выбрать файл заново
            </Button>
          ) : null}
        </div>
        <label className="lab-field lab-upload-edit">
          Название вложения
          <input defaultValue="Шаблон технического решения" />
          <small>
            Попробуйте продолжить ввод во время загрузки: уведомление не должно
            перехватывать фокус.
          </small>
        </label>
        {reduced && variant === 1 ? (
          <p className="lab-notice">
            При уменьшенном движении Sileo отключён. Постоянный текст результата
            и объявления остаются доступны.
          </p>
        ) : null}
      </section>
      {variant === 1 && !reduced ? (
        <div className="lab-toaster" aria-label="Область уведомления Sileo">
          <Toaster
            position={mobile ? "bottom-center" : "top-right"}
            offset={mobile ? { bottom: 18 } : { top: 16, right: 16 }}
            theme="light"
          />
        </div>
      ) : null}
      <p className="lab-source-note">
        {variant === 0
          ? "База: текст и индикатор загрузки из текущего потока вложений, воспроизведённые на fixtures."
          : "Эксперимент: Sileo 0.1.6 (MIT), только development. Уведомление дополняет постоянный результат. При reduced motion используется статический результат."}{" "}
        Сеть и загрузка имитируются кнопками завершения.
      </p>
    </>
  );
}
