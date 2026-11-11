// @ts-nocheck
/*
 * Trainer widget script. Telegram runs it in QuickJS inside the message bubble: no network, no
 * keyboard, no scrolling. The bot owns every rule; this script only draws what the bot sent.
 *
 * Data in: the chat state of the message (home screen) and the answers to requests. Each is a JSON
 * array whose first item names the screen; trainer-widget-wire.ts documents the shapes.
 * Data out: TelegramWidget.request(data), made synchronously inside a tap handler, one per tap.
 *
 * Bot texts reach the page only as element content through esc(); attribute values and onclick
 * arguments are built from this file's own constants and numbers.
 */
{
  const widget = window.TelegramWidget;
  const root = document.getElementById("w");
  /** Tallest screen the guide recommends at a 320 px bubble; the bubble clips at 600 px. */
  const MAX_HEIGHT = 560;
  const MIN_FONT_SIZE = 11;

  let home;
  let current;
  let question;
  let picked;
  let topics;
  let lastRequest;
  let questionFont;
  let judging = false;
  /** Characters of the explanation before the page the person reads. */
  let explanationOffset = 0;
  let explanationSize = 200;
  widget.setResizeAnchor?.("bottom");

  const esc = (text) =>
    text.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`);
  const days = (count) =>
    ["день", "дня", "дней"][
      count % 100 > 10 && count % 100 < 20
        ? 2
        : count % 10 == 1
          ? 0
          : count % 10 > 1 && count % 10 < 5
            ? 1
            : 2
    ];

  const button = (action, classes, html, disabled) =>
    `<button class="${classes}" onclick="g('${action}')"${disabled ? " disabled" : ""}>${html}</button>`;
  const card = (action, classes, title, hint) =>
    button(
      action,
      classes + " R",
      `<span class=F><b>${title}</b><span class=mu>${hint}</span></span>`,
    );
  const header = (title) =>
    `<div class=R>${button("h", "x", "←")}<b class=F>${title}</b></div>`;
  const track = (share) =>
    `<div class=T><i style="width:${share * 100}%"></i></div>`;
  const tile = (value, label) =>
    `<div class=K><b>${value}</b><span class=mu>${label}</span></div>`;
  const pair = (left, right) => `<div class=R>${left}${right}</div>`;
  /** Arrows around a counter; an arrow without an action is disabled. */
  const arrows = (back, label, forward, tail = "") =>
    pair(
      button(back, "bt", "←", !back),
      `<span>${label}</span>` + button(forward, "bt", "→", !forward) + tail,
    );
  const pager = (prefix, page = 0, pages = 1) =>
    pages < 2
      ? ""
      : arrows(
          page ? prefix + (page - 1) : "",
          `${page + 1}/${pages}`,
          page + 1 < pages ? prefix + (page + 1) : "",
        );
  /** A screen of one text under a title, with its main button. */
  const note = (title, text, action, label) =>
    `<b class=U>${title}</b><div>${esc(text)}</div>` +
    button(action, "bt P", label);
  /** Round steps: answered ones are filled or dashed, the current one has a contrasting outline. */
  const roundHead = (marks, total, extra, daily) =>
    `<div class=R>${button("h", "x", "×")}${
      !daily
        ? `<div class="R F st">${[...Array(total)]
            .map(
              (_, step) =>
                `<i class="${marks[step] ? (+marks[step] ? "G" : "B") : step == marks.length ? "S" : ""}"></i>`,
            )
            .join("")}</div>`
        : "<b class=F>Вопрос дня</b>"
    }${extra}</div>`;
  /** An op is a bt only while it can be tapped: Telegram dims disabled buttons. */
  const option = (index, text, classes, tappable) => {
    const body = `<i class=y>${"АБВГ"[index]}</i><span class=F>${esc(text)}</span>`;
    return tappable
      ? button("P" + index, "op R" + classes, body)
      : `<div class="op R${classes}">${body}</div>`;
  };

  const votes = ["Оценить", "👍", "👎"];
  /** One reserved panel for choosing an answer, its verdict and continuing the round. */
  const feedback = (d) => {
    const review = question[8] != null;
    if (!d)
      return (
        `<div class=fb><b class=V>${review ? "Ответ сохранён" : question[5] ? "Выберите все верные варианты." : "Выберите ответ"}</b>` +
        (review || question[5]
          ? button(
              "S",
              "bt P",
              review ? "Показать разбор" : "Ответить",
              !review && !picked,
            )
          : "") +
        "</div>"
      );
    // The text is cut every explanationSize characters. A word that crosses a cut moves to
    // the next page whole, so a page may be longer by that word; a word longer than a page
    // is cut. The pages are joined by a character no text has, so line breaks stay text.
    const parts = (
      (d[4] + (d[7] ? " " + d[7] : "")).match(
        new RegExp(".{1," + explanationSize + "}", "gsu"),
      ) || []
    )
      .join("\0")
      .replace(/(\s)(\S+)\0(?=\S)/g, "$1\0$2")
      .split("\0");
    // The page that holds the place the person reads, and the characters before it.
    let page = 0;
    let start = 0;
    for (
      ;
      parts[page + 1] && start + parts[page].length <= explanationOffset;
      start += parts[page++].length
    );
    const id = question[1];
    const vote = (value) =>
      button(
        "f" + id + ":" + (d[8] == value ? 0 : value),
        "bt" + (d[8] == value ? " P" : ""),
        votes[value],
      );
    // A long explanation comes in parts: d[9] is this part, d[10] their number. The arrows
    // turn the pages of a part and ask the bot for the part before or after it.
    const part = d[9] || 0;
    const another = "m" + id + ":";
    const buttons =
      button("F", "bt" + (d[8] ? " P" : ""), votes[d[8] || 0]) +
      button(
        question[9] ? "h" : "n" + id,
        "bt P",
        d[5].length < d[6] ? "Дальше" : question[9] ? "Готово" : "К итогу",
      );
    return (
      `<div class=fb><b class="V ${!d[1] ? "B" : d[1] < 3 ? "G" : ""}">${["Неверно", "Верно", "Верно, +1 очко", "Разберём"][d[1]]}</b><div class=W>${esc(parts[page])}</div>` +
      (judging
        ? pair(vote(1), vote(2) + button("F", "bt", "←"))
        : parts[1] || d[10]
          ? arrows(
              page
                ? "E" + (start - parts[page - 1].length)
                : part
                  ? another + (part - 1)
                  : "",
              `${page + 1}/${parts.length}`,
              parts[page + 1]
                ? "E" + (start + parts[page].length)
                : part + 1 < d[10]
                  ? another + (part + 1)
                  : "",
              buttons,
            )
          : pair(buttons, "")) +
      "</div>"
    );
  };

  const questionScreen = (d) => {
    const answered = d[0] == "e";
    const q = question;
    const review = q[8] != null;
    return (
      "<div class=j>" +
      roundHead(
        answered ? d[5] : q[6],
        q[7],
        review
          ? ""
          : answered
            ? "<span class=n></span>"
            : button("K", "bt n", "Не знаю"),
        q[9],
      ) +
      // q[10]: the question has a context; the person may read it again at any moment.
      `<div class="R mu"><span class=F>${esc(q[2])}</span>${q[10] ? button("c" + q[1], "bt n", "Условие") : ""}</div><div class=Q>${esc(q[3])}</div>` +
      q[4]
        .map((text, i) =>
          option(
            i,
            text,
            answered
              ? (d[2] >> i) & 1
                ? " G Z"
                : (d[3] >> i) & 1
                  ? " B Z"
                  : ""
              : (picked >> i) & 1
                ? " S Z"
                : "",
            !answered && !review,
          ),
        )
        .join("") +
      feedback(answered ? d : null) +
      "</div>"
    );
  };

  const screens = {
    // ["h", streak, answeredToday, dailyGoal, dailyQuestionDone]
    h: (d) =>
      `<div class=R><b class="F U a">Тренажёр</b><span class=ch>Серия: ${d[1]} ${days(d[1])}</span></div>` +
      `<div class="R mu"><span class=F>Цель на сегодня</span>${d[2]} из ${d[3]} вопросов</div>` +
      track(d[2] / d[3]) +
      card("q", "cd a", "Проверить себя", "5 вопросов, около 2 минут") +
      card("d", "cd a", "Вопрос дня", "Один вопрос, общий для всех") +
      card("t", "cd a", "Тренировка по теме", "10 вопросов по выбранной теме") +
      pair(button("p", "bt a", "Прогресс"), button("l0", "bt a", "Рейтинг")),

    // ["t", [[code, name, done, total], …]]
    t: (d) => (
      (topics = d[1]),
      header("Выберите тему") +
        `<div class=j>${d[1]
          .map((row, index) =>
            button(
              "T" + index,
              "cd R",
              `<span class=F>${esc(row[1])}</span><span class=mu>${row[2]} из ${row[3]}</span>`,
            ),
          )
          .join("")}</div>` +
        pager("t:", d[2], d[3])
    ),

    q: questionScreen,
    e: questionScreen,

    // ["r", title, correct, total, comment, points, streak, weekPlace, topicRound]
    r: (d) =>
      `<div class=C><div class=mu>${esc(d[1])}</div><div class=I>${d[2]} из ${d[3]}</div><div class=W>${esc(d[4])}</div></div>` +
      `<div class=R>${tile("+" + d[5], "очки")}${tile(d[6], "серия")}${tile(d[7] || "–", "место за неделю")}</div>` +
      button(d[8] ? "t" : "q", "bt P", d[8] ? "Другая тема" : "Ещё раунд") +
      pair(button("h", "bt", "На главный"), button("l0", "bt", "Рейтинг")),

    // ["p", points, streak, answered, [[name, done, total, correctPercent], …]]
    p: (d) =>
      header("Прогресс") +
      `<div class=R>${tile(d[1], "очки")}${tile(d[2], "серия")}${tile(d[3], "вопросов")}</div>` +
      `<div>${d[4]
        .map(
          (row) =>
            `<div class=ls><div class="W e">${esc(row[0])}</div><div class=R>${track(row[1] / row[2])}<span class=mu>${row[3] < 0 ? "не начато" : row[3] + "% верных"}</span></div></div>`,
        )
        .join("")}</div>` +
      pager("p:", d[5], d[6]),

    // ["l", allTime, legacy preference (ignored), [[place, name, points, isViewer], …]]
    l: (d) => {
      const tab = d[1] ? 1 : 0;
      return (
        header("Рейтинг") +
        `<div class="R tb">${button("l0", tab ? "" : "O", "Неделя")}${button("l1", tab ? "O" : "", "Всё время")}</div>` +
        `<div>${d[3]
          .map(
            (row) =>
              `<div class="R rk${row[3] ? " M" : ""}"><span class=mu>${row[0]}</span><span class="F e">${esc(row[1])}</span><b>${row[2]}</b></div>`,
          )
          .join("")}</div>` +
        "<div class=mu>Очки за верные ответы в завершённых раундах.</div>"
      );
    },

    // ["c", issueId, context]: the situation of a question, read before the question itself.
    c: (d) => note("Условие", d[2], "o" + d[1], "К вопросу"),

    i: (d) => note("Тренажёр", d[1], "h", "На главный"),

    // ["x", text?]: the bot refused, did not answer in 15 seconds, or sent something unreadable.
    x: (d) =>
      note("Бот не ответил", d[1] || "", "R", "Повторить") +
      button("H", "bt", "На главный"),
  };

  const draw = (data) => {
    current = data;
    const inQuestion = data[0] == "q" || data[0] == "e";
    root.style.fontSize = inQuestion && questionFont ? questionFont : "";
    const render = () => (root.innerHTML = screens[data[0]](data));
    render();
    if (data[0] == "e") {
      // Smaller pages until the screen fits; the page that holds the read place is shown.
      while (document.body.offsetHeight >= MAX_HEIGHT && explanationSize > 10) {
        explanationSize -= 10;
        render();
      }
    } else if (!inQuestion || !questionFont) {
      // A question leaves 120 px for the verdict, two lines of the explanation and the
      // buttons: a larger reserve takes the room of a long question's own text.
      const reserve = () =>
        data[0] == "q" ? 120 - root.querySelector(".fb").offsetHeight : 0;
      for (
        let size = parseFloat(getComputedStyle(root).fontSize);
        document.body.offsetHeight + reserve() >= MAX_HEIGHT &&
        size > MIN_FONT_SIZE;
      )
        root.style.fontSize = --size + "px";
      if (inQuestion) questionFont = getComputedStyle(root).fontSize;
    }
  };
  const show = (data) => {
    try {
      if (data[0] == "u") {
        if (data[1] != question?.[1] || current[0] != "e") return;
        judging = false;
        current[8] = data[2];
        data = current;
      }
      if (data[0] == "h") home = data;
      if (data[0] == "q") {
        // The same question comes again after its context: the picked options stay.
        const same = data[1] == question?.[1];
        questionFont = same ? questionFont : "";
        judging = false;
        question = data;
        // A review carries the stored pick; otherwise the person's own marks stay.
        picked = data[8] ?? (same ? picked : 0);
      }
      // Each part of an explanation starts from its first page.
      if (data != current) {
        explanationOffset = 0;
        explanationSize = 200;
      }
      draw(data);
    } catch {
      draw(["x"]);
    }
  };
  const parse = (text) => {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;
    } catch {
      // Not JSON: the caller falls back to the empty home screen or the retry state.
    }
  };

  const ask = (data) => {
    let pending;
    lastRequest = data;
    root.className = "wt";
    try {
      // "2" marks a widget that knows contexts and explanation parts.
      pending = widget.request("2" + data);
    } catch {
      pending = Promise.reject();
    }
    pending
      .then(
        (answer) => parse(answer.result),
        () => 0,
      )
      .then((data) => {
        root.className = "";
        show(data || ["x"]);
      });
  };
  const answer = (mask) => ask(`a${question[1]}:${mask}`);

  /** Every tap lands here. Capital letters are handled in the widget, the rest go to the bot. */
  window.g = (action) => {
    const index = +action.slice(1);
    if (root.className) return;
    if (action == "F") {
      judging = !judging;
      draw(current);
    } else if (action[0] == "E") {
      explanationOffset = index;
      draw(current);
    } else if (action[0] == "P") {
      if (question[5]) {
        picked ^= 1 << index;
        draw(question);
      } else answer(1 << index);
    } else if (action == "S") answer(picked);
    else if (action == "K") answer(0);
    else if (action[0] == "T") ask("t" + topics[index][0]);
    else if (action == "R") ask(lastRequest || "h");
    else if (action == "H") show(home);
    else ask(action);
  };

  const start = () => {
    const data = parse(widget.chatData);
    home = data && data[0] == "h" ? data : ["h", 0, 0, 5, 0];
    if (!current || current[0] == "h") show(home);
  };
  widget.onEvent("chatDataChanged", start);
  start();
}
