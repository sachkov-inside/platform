"use client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  acknowledgeCourseAssistantDataNotice,
  beginCourseAssistantRepositoryConnection,
  disconnectCourseAssistantRepository,
  linkCourseAssistantRepository,
  readCourseAssistantRepositories,
} from "../api/course-assistant.browser";
import {
  courseAssistantErrorMessage,
  type CourseAssistantParticipant,
  type CourseAssistantWriteResult,
  type LinkableRepository,
  type RepositoryConnectionOutcome,
} from "../model/course-assistant";
import {
  CourseAssistantPanelView,
  type CourseAssistantAction,
} from "./course-assistant-panel-view";

/**
 * Производственный путь экрана помощника: каждое действие — своя мутация через собственный BFF;
 * после записи страница перечитывает состояние на сервере.
 */
export function CourseAssistantPanel({
  participant,
  outcome,
}: {
  readonly participant: CourseAssistantParticipant;
  readonly outcome?: RepositoryConnectionOutcome | undefined;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [repositories, setRepositories] =
    useState<readonly LinkableRepository[]>();

  const settle = (result: CourseAssistantWriteResult) => {
    if (!result.ok) {
      setError(courseAssistantErrorMessage(result.code));
      return;
    }
    setError(undefined);
    setRepositories(undefined);
    router.refresh();
  };
  const acknowledge = useMutation({
    mutationFn: () =>
      acknowledgeCourseAssistantDataNotice(participant.dataNotice.version),
    retry: false,
    onSuccess: settle,
  });
  const connect = useMutation({
    mutationFn: beginCourseAssistantRepositoryConnection,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(courseAssistantErrorMessage(result.code));
        return;
      }
      window.location.assign(result.installUrl);
    },
  });
  const listRepositories = useMutation({
    mutationFn: readCourseAssistantRepositories,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(courseAssistantErrorMessage(result.code));
        return;
      }
      setError(undefined);
      setRepositories(result.repositories);
    },
  });
  const link = useMutation({
    mutationFn: linkCourseAssistantRepository,
    retry: false,
    onSuccess: settle,
  });
  const disconnect = useMutation({
    mutationFn: disconnectCourseAssistantRepository,
    retry: false,
    onSuccess: settle,
  });

  const { mutate: showRepositories } = listRepositories;
  // После установки с несколькими репозиториями выбор нужен сразу, без лишнего нажатия.
  useEffect(() => {
    if (outcome === "choose_repository") showRepositories();
  }, [outcome, showRepositories]);

  const pending: CourseAssistantAction | undefined = acknowledge.isPending
    ? "acknowledge"
    : connect.isPending || connect.data?.ok === true
      ? "connect"
      : listRepositories.isPending
        ? "repositories"
        : link.isPending
          ? "link"
          : disconnect.isPending
            ? "disconnect"
            : undefined;

  return (
    <CourseAssistantPanelView
      error={error}
      onAcknowledge={() => {
        acknowledge.mutate();
      }}
      onConnect={() => {
        connect.mutate();
      }}
      onDisconnect={() => {
        disconnect.mutate();
      }}
      onLink={(candidate) => {
        link.mutate({
          installationId: candidate.installationId,
          repositoryId: candidate.repository.id,
        });
      }}
      onShowRepositories={() => {
        showRepositories();
      }}
      outcome={outcome}
      participant={participant}
      pending={pending}
      repositories={repositories}
    />
  );
}
