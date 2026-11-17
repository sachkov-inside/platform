"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  createCourseFilmRenderer,
  readServerFilmSelection,
  type FilmVersion,
} from "./course-film.browser";
import { FILM_V3_DESCRIPTION } from "../model/course-film-v3";
import "./course-film.css";

const subscribeNothing = () => () => undefined;
const readFilmVersion = (): FilmVersion => {
  const asked = new URLSearchParams(window.location.search).get("film");
  return asked === "v1" || asked === "v2" ? asked : "v3";
};
const readServerFilmVersion = (): FilmVersion => "v3";

// The owner chose reduced-motion posters without a pause control (platform#808, 30.09.2026).
export function CourseFilm({
  autoplay = true,
}: {
  readonly autoplay?: boolean;
}) {
  const version = useSyncExternalStore(
    subscribeNothing,
    readFilmVersion,
    readServerFilmVersion,
  );
  const [renderer] = useState(createCourseFilmRenderer);
  const selection = useSyncExternalStore(
    renderer.subscribe,
    renderer.readSelection,
    readServerFilmSelection,
  );
  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas !== null) return renderer.attach(canvas, version, autoplay);
      return undefined;
    },
    [renderer, version, autoplay],
  );
  const description =
    selection.version === version ? selection.description : FILM_V3_DESCRIPTION;
  return (
    <div className="aie-film">
      <canvas aria-label={description} ref={attach} role="img" />
    </div>
  );
}
