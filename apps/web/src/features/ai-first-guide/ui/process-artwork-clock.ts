const durations = [4000, 3600, 3400, 3600, 3600];
const starts = [0, 4000, 7600, 11000, 14600];
const end = 19400;

export type ProcessArtworkScene = 1 | 2 | 3 | 4 | 5;
export interface ProcessArtworkOptions {
  readonly mode: "animated" | "static";
  readonly scene?: ProcessArtworkScene;
  readonly loop?: boolean;
}

/** Owns only the presentation subtree, never React state or application data. */
export function mountProcessArtwork(host: HTMLElement, { mode, scene = 5, loop = false }: ProcessArtworkOptions) {
  const stage = host.querySelector<HTMLElement>(".stage");
  if (!stage) throw new Error("Process artwork stage is missing");
  const scenes = [...stage.querySelectorAll<HTMLElement>(".scene")];
  const segments = [...stage.querySelectorAll<HTMLElement>(".stage-progress i")];
  const register = (el: HTMLElement) => {
    const text = el.textContent;
    const next = el.nextElementSibling;
    return { el, text, start: Number(el.dataset.t ?? 0), speed: Number(el.dataset.speed ?? 42), caret: next?.classList.contains("caret") ? next : null };
  };
  const typers = scenes.map(item => [...item.querySelectorAll<HTMLElement>(".type")].map(register));
  const steps = [...stage.querySelectorAll<HTMLElement>(".stage-step .type")].map(register);
  const allTypers = [...typers.flat(), ...steps];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current = -1;
  let elapsed = 0;
  let lastNow = 0;
  let raf = 0;
  let inView = false;
  let running = false;
  let staticMode = mode === "static" || reduced.matches;
  let leavingUntil = 0;
  let leaving: HTMLElement | undefined;
  let pausedAnimations: Animation[] = [];

  function activate(index: number) {
    if (current >= 0 && current !== index) {
      leaving?.classList.remove("is-active", "is-leaving");
      leaving = scenes[current];
      leaving?.classList.add("is-leaving");
      leavingUntil = elapsed + 400;
    }
    current = index;
    const active = scenes[index];
    active?.classList.remove("is-active", "is-leaving");
    if (active) { void active.offsetWidth; active.classList.add("is-active"); }
    for (const typer of typers[index] ?? []) { typer.el.textContent = ""; typer.caret?.classList.remove("is-on"); }
    steps.forEach((step, i) => { step.el.hidden = i !== index; step.el.textContent = ""; });
    segments.forEach((segment, i) => {
      segment.classList.remove("is-done", "is-active");
      if (i < index) segment.classList.add("is-done");
      if (i === index) {
        segment.style.setProperty("--d", `${String(durations[i] ?? 0)}ms`);
        void segment.offsetWidth;
        segment.classList.add("is-active");
      }
    });
    if (stage) stage.dataset.scene = String(index + 1);
  }

  function renderTyping(sceneTime: number) {
    const step = steps[current];
    for (const typer of [...(typers[current] ?? []), ...(step ? [step] : [])]) {
      const length = Math.max(0, Math.min(typer.text.length, Math.floor((sceneTime - typer.start) / typer.speed)));
      if (typer.el.textContent.length !== length) typer.el.textContent = typer.text.slice(0, length);
      typer.caret?.classList.toggle("is-on", sceneTime >= typer.start && sceneTime <= typer.start + typer.text.length * typer.speed + 800);
    }
  }

  function pause() {
    running = false;
    cancelAnimationFrame(raf);
    // Includes the glow transition; both CSS and scene clocks resume from the same point.
    pausedAnimations = host.getAnimations({ subtree: true }).filter(animation => animation.playState === "running");
    for (const animation of pausedAnimations) animation.pause();
    stage?.classList.add("is-paused");
  }

  function tick(now: number) {
    if (!running) return;
    elapsed += now - lastNow;
    lastNow = now;
    if (leaving && elapsed >= leavingUntil) { leaving.classList.remove("is-active", "is-leaving"); leaving = undefined; }
    if (elapsed >= end) {
      if (loop) { elapsed = 0; activate(0); }
      else { pause(); return; }
    }
    let index = 0;
    while (index < 4 && elapsed >= (starts[index + 1] ?? end)) index += 1;
    if (index !== current) activate(index);
    renderTyping(elapsed - (starts[index] ?? 0));
    raf = requestAnimationFrame(tick);
  }

  function syncVisibility() {
    const shouldRun = !staticMode && inView && !document.hidden && (loop || elapsed < end);
    if (shouldRun && !running) {
      if (current < 0) activate(0);
      stage?.classList.remove("is-paused");
      for (const animation of pausedAnimations) if (animation.playState === "paused") animation.play();
      pausedAnimations = [];
      running = true;
      lastNow = performance.now();
      raf = requestAnimationFrame(tick);
    } else if (!shouldRun && running) pause();
  }

  function resetMode() {
    cancelAnimationFrame(raf);
    for (const animation of pausedAnimations) animation.cancel();
    pausedAnimations = [];
    running = false;
    current = -1;
    elapsed = 0;
    leaving = undefined;
    staticMode = mode === "static" || reduced.matches;
    stage?.classList.remove("is-paused", "is-static");
    scenes.forEach(item => { item.classList.remove("is-active", "is-leaving"); });
    if (staticMode) {
      stage?.classList.add("is-static");
      const index = mode === "static" ? scene - 1 : 4;
      activate(index);
      for (const typer of allTypers) { typer.el.textContent = typer.text; typer.caret?.classList.remove("is-on"); }
      segments.forEach((segment, i) => { segment.classList.remove("is-active"); segment.classList.toggle("is-done", i <= index); });
    } else syncVisibility();
  }

  const observer = new IntersectionObserver(([entry]) => { inView = entry?.isIntersecting ?? false; syncVisibility(); });
  observer.observe(host);
  document.addEventListener("visibilitychange", syncVisibility);
  reduced.addEventListener("change", resetMode);
  resetMode();
  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    document.removeEventListener("visibilitychange", syncVisibility);
    reduced.removeEventListener("change", resetMode);
    for (const animation of pausedAnimations) animation.cancel();
    stage.classList.remove("is-static", "is-paused");
    delete stage.dataset.scene;
    scenes.forEach(item => { item.classList.remove("is-active", "is-leaving"); });
    segments.forEach(segment => { segment.classList.remove("is-active", "is-done"); });
    for (const typer of allTypers) { typer.el.textContent = typer.text; typer.caret?.classList.remove("is-on"); }
  };
}
