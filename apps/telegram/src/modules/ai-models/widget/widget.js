// @ts-nocheck
/*
 * ИИ-модели widget script. Telegram runs it in QuickJS inside the message bubble: no network, no
 * keyboard, no scrolling. The bot owns every rule; this script only draws what the bot sent.
 *
 * Data in: the chat state of the message (the first page of «Мощные») and the answers to
 * requests. Each is a JSON array whose first item names the screen; ai-models-widget-wire.ts
 * documents the shapes and the fixed words this script adds to them.
 * Data out: TelegramWidget.request("3" + request), one at a time: a tap while a request is in
 * flight does nothing.
 *
 * Bot texts reach the page only as element content through esc(). A button calls g() with the
 * number of its action in `actions`, so no text of the bot, model codes included, is ever part
 * of an attribute.
 */
{
  const widget = window.TelegramWidget;
  const root = document.getElementById("w");

  /**
   * The screen drawn, the last screen of the bot drawn (never an error), the screens «‹» returns
   * to and the last request, which «Повторить» repeats.
   */
  let view;
  let current;
  let stack = [];
  let last = "lp0";
  /** Second lines of list rows end in an ellipsis: the page did not fit 560 px otherwise. */
  let clip;
  /** What each button of the screen on view does, by its number. */
  let actions;
  widget.setResizeAnchor?.("bottom");

  const esc = (text) =>
    text.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`);

  // An action is a request to the bot, "+" before it keeps the screen on view for «‹», or one
  // of the widget's own: "B" back, "R" the last request again.
  const button = (action, classes, html, disabled) =>
    `<button class="${classes}" onclick=g(${actions.push(action) - 1})${disabled ? " disabled" : ""}>${html}</button>`;
  const back = () => button("B", "x", "‹");

  const badges = {
    f: "⭐ Мой выбор",
    c: "Уверенная",
    m: "Для средних задач",
    p: "Дорого",
    w: "Невыгодно",
    b: "Риск бана",
  };
  const levels = { h: "высокий", m: "средний", l: "низкий" };
  const yes = { y: "да", n: "нет", u: "нет данных" };
  const filters = {
    p: "Мощные",
    f: badges.f,
    v: "Цена/качество",
    c: "Дёшево",
  };
  // A badge; the level of a ban risk follows its name in the card.
  const badge = (code) =>
    `<span class="bd b${code[0]}">${badges[code[0]]}${code[1] ? ": " + levels[code[1]] : ""}</span>`;
  /** Five dots; `price` paints the price level in ink, `lead` the last dot of a leader in gold. */
  const dots = (count, lead, price) =>
    `<span class="D${price ? " pr" : ""}">${[1, 2, 3, 4, 5]
      .map(
        (dot) =>
          `<i class=${dot > count ? "" : dot > 4 && lead ? "Y" : "n"}></i>`,
      )
      .join("")}</span>`;
  const sm = (html, classes = "") => `<div class="sm ${classes}">${html}</div>`;
  const muted = (html) => `<span class="mu sm">${html}</span>`;

  /** Title, Мощность and price level, and the tabs of a card. */
  const cardHead = (d, tab) =>
    `<div class=R>${back()}<b class="F U q">${esc(d[2])}</b></div>` +
    `<div class="R sm">Мощность ${dots(d[3], d[4])} Цена ${dots(d[5], 0, 1)}</div>` +
    `<div class=R>${button("m" + d[1], "ch" + (tab ? "" : " O"), "Главное")}${button("s" + d[1], "ch" + (tab ? " O" : ""), "Подписки")}</div>`;

  const screens = {
    // ["l", filter, page, pages, "ДД.ММ", rows]; a row is "code|name|power|leader|badges|price|plan|summary".
    l: (d) =>
      `<div class=R><b class="F U">ИИ-модели</b>${button("+a", "k", `Проверено ${esc(d[4])} ›`)}</div>` +
      `<div class=C>${Object.keys(filters)
        .map((filter) =>
          button(
            "l" + filter + 0,
            "ch" + (filter == d[1] ? " O" : ""),
            filters[filter],
          ),
        )
        .join("")}</div><div>` +
      (d[1] == "v"
        ? "<div class=gh>По независимым замерам, без мнения автора</div>"
        : "") +
      d[5]
        .map((row) => {
          if (row.pop) return `<div class=gh>${esc(row[1])}</div>`;
          const [code, name, power, lead, codes, price, plan, summary] =
            row.split("|");
          return button(
            "+m" + code,
            "rw",
            `<span class=R><b class=F>${esc(name)}</b>${dots(power, +lead)}${
              d[1] == "c"
                ? `<b>${esc(price)}</b>` + muted(" задача")
                : price && `<b class=sm>${esc(price)}</b>`
            }</span><span class="l2${clip ? " Z" : ""}">${[...codes].map(badge).join("")}${
              d[1] == "c"
                ? `<b>${plan ? "подписка от " + esc(plan) : "только API"}</b> · `
                : ""
            }${esc(summary)}</span>`,
          );
        })
        .join("") +
      "</div>" +
      (d[3] > 1
        ? `<div class="R pg">${button("l" + d[1] + (d[2] - 1), "x", "‹", !d[2])}${muted(`${d[2] + 1} из ${d[3]}`)}${button("l" + d[1] + (d[2] + 1), "x", "›", d[2] + 1 == d[3])}</div>`
        : "") +
      (d[1] == "v"
        ? sm(
            "Мощность: рейтинг агентов Arena. Цена: одна задача по API. Здесь модели, которым нет замены сильнее и дешевле одновременно.",
            "mu",
          )
        : ""),

    // ["m", code, name, power, leader, priceLevel, api, summary, opinion, betterPick, tags, agent, notice]
    m: (d) => {
      const pick = d[9];
      const opinion =
        d[8]
          .map(([code, text]) => sm((code ? badge(code) : "") + esc(text)))
          .join("") +
        (pick[0]
          ? sm(
              "Лучше взять: " +
                [1, 3]
                  .filter((at) => pick[at])
                  .map((at) =>
                    button("+m" + pick[at], "k", esc(pick[at + 1]) + " ›"),
                  )
                  .join(" или ") +
                ", " +
                esc(pick[0]),
            )
          : "");
      return (
        cardHead(d) +
        sm("API: " + esc(d[6])) +
        `<b>«${esc(d[7])}»</b>` +
        (opinion
          ? `<div class=op>${sm("Мнение автора", "mu")}${opinion}</div>`
          : "") +
        `<div>${d[10].map((tag) => `<span class=tg>${esc(tag)}</span>`).join("")}</div>` +
        `<div class=cd>${sm(d[11][0] == "m" ? "Лучший агент по замерам" : "Агент, который советует компания", "mu")}<b>${esc(d[11][1])}</b> ${muted(esc(d[11][2]))}${sm("Ещё: " + esc(d[11][3]), "mu")}</div>` +
        (d[12] ? `<div class=nt>${esc(d[12])}</div>` : "")
      );
    },

    // ["s", code, name, power, leader, priceLevel, [[service, banRisk, russia, plans], …]];
    // a plan is "label|basis|estimate|multiple|wording|note|promo".
    s: (d) =>
      cardHead(d, 1) +
      `<div>${
        d[6]
          .map(
            ([name, risk, russia, plans]) =>
              `<div class=gp><b>${esc(name)}</b> ${risk ? badge("b" + risk) : ""} · ${
                russia == "uu"
                  ? "из России и карта РФ: нет данных"
                  : `из России: ${yes[russia[0]]} · карта РФ: ${yes[russia[1]]}`
              }</div>` +
              plans
                .map((plan) => {
                  const [label, basis, estimate, multiple, wording, note] =
                    plan.split("|");
                  const more = [
                    multiple && `в ${esc(multiple)} больше цены`,
                    basis == "o" && "лимит OpenCode",
                    note && esc(note),
                  ].filter((part) => part);
                  return `<div class="R pl"><b class=pn>${esc(label)}</b><span class=F>${
                    basis == "v"
                      ? muted([esc(wording), ...more].join(", "))
                      : `<b class=es>${esc(estimate)} в месяц по API</b> ` +
                        muted(more.join(", "))
                  }</span></div>`;
                })
                .join(""),
          )
          .join("") || "<div class=mu>Подписок нет, только API</div>"
      }</div>`,

    // ["a", "ДД.ММ.ГГГГ", lines]
    a: (d) =>
      `<div class=R>${back()}<b class="F U">О данных</b></div><div>Проверено ${esc(d[1])}</div><div>${d[2]
        .map((line) => `<div class=pl>${esc(line)}</div>`)
        .join("")}</div>`,

    // ["x", text?]: the bot refused, did not answer in 15 seconds, or sent something unreadable.
    x: (d) =>
      `<div class=R>${current ? back() : ""}<b class="F U">ИИ-модели</b></div><div>${esc(d[1] || "Бот не ответил.")}</div>` +
      button("R", "bt P", "Повторить"),
  };

  const tall = () => document.body.offsetHeight > 560;
  /** Draws a screen, or the retry state when the screen cannot be drawn, and fits it. */
  const draw = (data) => {
    const render = () => {
      actions = [];
      root.innerHTML = screens[(view = data)[0]](data);
    };
    root.style.fontSize = clip = "";
    try {
      render();
    } catch {
      data = ["x"];
      render();
    }
    // Summaries wrap while the screen fits 560 px; then they end in an ellipsis, and only then
    // the text gets smaller, never below 11 px.
    if (tall()) {
      clip = 1;
      render();
    }
    for (
      let size = parseFloat(getComputedStyle(root).fontSize);
      tall() && size > 11;
    )
      root.style.fontSize = --size + "px";
  };
  /** Shows a screen; with `push` the current one waits for «‹» once the new one is drawn. */
  const show = (data, push) => {
    const before = current;
    draw(data);
    if (view[0] != "x") {
      if (push && before) stack.push(before);
      current = view;
    }
  };
  const parse = (text) => {
    try {
      const data = JSON.parse(text);
      // A screen is an array, and an array has pop; the bot sends no object with that key.
      if (data.pop) return data;
    } catch {
      // Not JSON, or null: the caller shows the retry state.
    }
  };

  const ask = (action) => {
    let pending;
    last = action;
    root.className = "wt";
    try {
      // "3" routes the request to ИИ-модели; every other request belongs to the Trainer.
      pending = widget.request("3" + action.replace("+", ""));
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
        // A screen opened with "+" keeps the one it replaces for «‹».
        show(data || ["x"], action[0] == "+");
      });
  };

  /** Every tap lands here with the number of its action. */
  window.g = (index) => {
    const action = actions[index];
    if (root.className) return;
    // «‹» on an error returns to the screen it covers; otherwise to the screen before.
    if (action == "B") show(view[0] == "x" ? current : stack.pop() || current);
    else ask(action == "R" ? last : action);
  };

  // The first page of «Мощные» comes with the message; without it the widget asks for it.
  const start = parse(widget.chatData);
  if (start?.[5]) show(start);
  else {
    root.innerHTML = "<b class=U>ИИ-модели</b>";
    ask("lp0");
  }
}
