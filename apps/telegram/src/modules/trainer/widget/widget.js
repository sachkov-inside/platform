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

  const esc = (text) =>
    String(text).replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`);
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
  const card = (action, classes, title, hint, mark) =>
    button(
      action,
      classes + " R",
      `<span class=F><b>${title}</b><span class=m>${hint}</span></span>${mark ? `<em>${mark}</em>` : ""}`,
    );
  const header = (title) =>
    `<div class=R>${button("h", "x", "←")}<b class=F>${title}</b></div>`;
  const track = (share) =>
    `<div class=T><i style="width:${share * 100}%"></i></div>`;
  const tile = (value, label) =>
    `<div class=K><b>${value}</b><span class=m>${label}</span></div>`;
  const pair = (left, right) => `<div class=R>${left}${right}</div>`;
  /** Round steps: answered ones are filled or dashed, the current one has a contrasting outline. */
  const roundHead = (marks, total, extra, daily) =>
    `<div class=R>${button("h", "x", "×")}${
      !daily
        ? `<div class="R F q">${[...Array(total)]
            .map(
              (_, step) =>
                `<i class="${marks[step] ? (+marks[step] ? "G" : "B") : step == marks.length ? "S" : ""}"></i>`,
            )
            .join("")}</div>`
        : "<b class=F>Вопрос дня</b>"
    }${extra}</div>`;
  /** An option is a button only while it can be tapped: Telegram dims disabled buttons. */
  const option = (index, text, classes, tappable) => {
    const body = `<i class=y>${"АБВГ"[index]}</i><span class=F>${esc(text)}</span>`;
    return tappable
      ? button("P" + index, "o R" + classes, body)
      : `<div class="o R${classes}">${body}</div>`;
  };

  /** One reserved panel for choosing an answer, its verdict and continuing the round. */
  const feedback = (d) => {
    const review = question[8] != null;
    return (
      `<div class=f><b class="V ${d ? (d[1] % 3 ? "G" : "B") : ""}">${d ? ["Неверно", "Верно", "Верно, +1 очко", "Разберём"][d[1]] : review ? "Ответ сохранён" : "Выберите ответ"}</b>` +
      `<div class=W>${d ? esc(d[4]) : review ? "Посмотрите разбор своего ответа." : question[5] ? "Можно выбрать несколько вариантов." : "Нажмите на вариант ответа."}</div>` +
      (d && d[7] ? `<div class=m>${esc(d[7])}</div>` : "") +
      (d
        ? button(
            question[9] ? "h" : "n" + question[1],
            "b P",
            d[5].length < d[6] ? "Дальше" : question[9] ? "Готово" : "К итогу",
          )
        : review || question[5]
          ? button(
              "S",
              "b P",
              review ? "Показать разбор" : "Ответить",
              !review && !picked,
            )
          : "") +
      "</div>"
    );
  };

  const screens = {
    // ["h", streak, answeredToday, dailyGoal, dailyQuestionDone]
    h: (d) =>
      `<div class=R><b class="F U a">Тренажёр</b><span class=c>Серия: ${d[1]} ${days(d[1])}</span></div>` +
      `<div class="R m"><span class=F>Цель на сегодня</span>${d[2]} из ${d[3]} вопросов</div>` +
      track(d[2] / d[3]) +
      card(
        "q",
        "k a",
        "Проверить себя",
        "5 случайных вопросов, около 2 минут",
      ) +
      card("d", "k a", "Вопрос дня", "Один вопрос, общий для всех") +
      card("t", "k a", "Тренировка по теме", "10 вопросов по выбранной теме") +
      pair(button("p", "b a", "Прогресс"), button("l0", "b a", "Рейтинг")),

    // ["t", [[code, name, done, total], …]]
    t: (d) => (
      (topics = d[1]),
      header("Выберите тему") +
        `<div>${d[1]
          .map((row, index) =>
            button(
              "T" + index,
              "R r",
              `<span class=F>${esc(row[1])}</span><span class=m>${row[2]} из ${row[3]}</span>`,
            ),
          )
          .join("")}</div>`
    ),

    // ["q", id, topic, text, [options], multi, marks, total, reviewMask?]
    q: (d) => {
      const review = d[8] != null;
      return (
        "<div class=j>" +
        roundHead(d[6], d[7], review ? "" : button("K", "n", "Не знаю"), d[9]) +
        `<div class=m>${esc(d[2])}</div><div class=Q>${esc(d[3])}</div>` +
        d[4]
          .map((text, index) =>
            option(index, text, (picked >> index) & 1 ? " S Z" : "", !review),
          )
          .join("") +
        feedback() +
        "</div>"
      );
    },

    // ["e", verdict, correctMask, pickedMask, text, marks, total, stat]
    // Keep the question and all options; feedback is added below them after the answer.
    e: (d) =>
      "<div class=j>" +
      roundHead(
        d[5],
        d[6],
        question[8] == null ? "<span class=n></span>" : "",
        question[9],
      ) +
      `<div class=m>${esc(question[2])}</div><div class=Q>${esc(question[3])}</div>` +
      question[4]
        .map((text, index) =>
          option(
            index,
            text,
            (d[2] >> index) & 1 ? " G Z" : (d[3] >> index) & 1 ? " B Z" : "",
          ),
        )
        .join("") +
      feedback(d) +
      "</div>",

    // ["r", title, correct, total, comment, points, streak, weekPlace, topicRound]
    r: (d) =>
      `<div class=C><div class=m>${esc(d[1])}</div><div class=I>${d[2]} из ${d[3]}</div><div class=W>${esc(d[4])}</div></div>` +
      `<div class=R>${tile("+" + d[5], "очки")}${tile(d[6], "серия, дней")}${tile(d[7] || "–", "место за неделю")}</div>` +
      button(d[8] ? "t" : "q", "b P", d[8] ? "Другая тема" : "Ещё раунд") +
      pair(button("h", "b", "На главный"), button("l0", "b", "Рейтинг")),

    // ["p", points, streak, answered, [[name, done, total, correctPercent], …]]
    p: (d) =>
      header("Прогресс") +
      `<div class=R>${tile(d[1], "очки")}${tile(d[2], "серия, дней")}${tile(d[3], "вопросов")}</div>` +
      `<div>${d[4]
        .map(
          (row) =>
            `<div class=r><div class="W e">${esc(row[0])}</div><div class=R>${track(row[1] / row[2])}<span class=m>${row[3] < 0 ? "не начато" : row[3] + "% верных"}</span></div></div>`,
        )
        .join("")}</div>`,

    // ["l", allTime, shown, [[place, name, points, isViewer], …]]
    // shown 2: the person has not chosen yet and gets the offer instead of the switch.
    l: (d) => {
      const tab = d[1] ? 1 : 0;
      return (
        header("Рейтинг") +
        `<div class="R t">${button("l0", tab ? "" : "O", "Неделя")}${button("l1", tab ? "O" : "", "Всё время")}</div>` +
        `<div>${d[3]
          .map(
            (row) =>
              `<div class="R u${row[3] ? " M" : ""}"><span class=m>${row[0]}</span><span class="F e">${esc(row[1])}</span><b>${row[2]}</b></div>`,
          )
          .join("")}</div>` +
        (d[2] > 1
          ? "<div><b>Показать вас в рейтинге?</b><div class=m>Другие увидят ваше имя из Telegram. Сейчас вас нет в таблицах.</div></div>" +
            pair(
              button("v1" + tab, "b P", "Показать меня"),
              button("v0" + tab, "b", "Не сейчас"),
            )
          : card(
              "v" + (d[2] ? 0 : 1) + tab,
              "k",
              "Показывать меня в рейтинге",
              d[2]
                ? "Другие видят ваше имя из Telegram"
                : "Сейчас вас нет в таблицах",
              d[2] ? "Вкл" : "Выкл",
            )) +
        "<div class=m>Очки даются за первый верный ответ на вопрос.</div>"
      );
    },

    i: (d) =>
      `<b class=U>Тренажёр</b><div>${esc(d[1])}</div>` +
      button("h", "b P", "На главный"),

    // ["x", text?]: the bot refused, did not answer in 15 seconds, or sent something unreadable.
    x: (d) =>
      `<b class=U>Не получилось</b><div>${esc(d[1] || "Бот не ответил. Проверьте связь и повторите.")}</div>` +
      button("R", "b P", "Повторить") +
      button("H", "b", "На главный"),
  };

  const draw = (data) => {
    current = data;
    root.style.fontSize = "";
    root.innerHTML = screens[data[0]](data);
    // Nothing scrolls inside a widget, so a screen that is too tall gets smaller text.
    for (
      let size = parseFloat(getComputedStyle(root).fontSize);
      root.offsetHeight > MAX_HEIGHT && size > MIN_FONT_SIZE;
    )
      root.style.fontSize = --size + "px";
  };
  const show = (data) => {
    try {
      if (data[0] == "h") home = data;
      if (data[0] == "q") {
        question = data;
        picked = data[8] || 0;
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
    root.className = "w";
    try {
      pending = widget.request(data);
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
    if (action[0] == "P") {
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
