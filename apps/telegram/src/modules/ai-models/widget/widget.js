// @ts-nocheck
/*
 * ИИ-модели widget script. Telegram runs it in QuickJS inside the message bubble: no network, no
 * keyboard, no scrolling. The bot owns every rule; this script only draws what the bot sent.
 *
 * Data in: the answers to requests, each a JSON array whose first item names the screen;
 * ai-models-widget-wire.ts documents the shapes. The message's chat state names the first page,
 * which the script asks for as soon as it starts.
 * Data out: TelegramWidget.request("3" + request), one at a time: a tap while a request is in
 * flight does nothing.
 *
 * Bot texts reach the page only as element content through esc(); attribute values and onclick
 * arguments are built from this file's own constants.
 */
{
  const widget = window.TelegramWidget;
  const root = document.getElementById("w");

  let lastRequest;
  widget.setResizeAnchor?.("bottom");

  const esc = (text) =>
    text.replace(/[&<>]/g, (char) => `&#${char.charCodeAt(0)};`);
  const button = (action, classes, html) =>
    `<button class="${classes}" onclick="g('${action}')">${html}</button>`;
  const title = "<b class=U>ИИ-модели</b>";

  const screens = {
    // The first answer is on its way.
    w: () => title + "<div class=mu>Загрузка…</div>",

    // ["x", text?]: the bot refused, did not answer in 15 seconds, or sent something unreadable.
    x: (d) =>
      title +
      `<div>${esc(d[1] || "Бот не ответил.")}</div>` +
      button("R", "bt P", "Повторить"),
  };

  const show = (data) => {
    try {
      root.innerHTML = screens[data[0]](data);
    } catch {
      root.innerHTML = screens.x(["x"]);
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

  const ask = (data) => {
    let pending;
    lastRequest = data;
    root.className = "wt";
    try {
      // "3" routes the request to ИИ-модели; every other request belongs to the Trainer.
      pending = widget.request("3" + data);
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

  /** Every tap lands here. Capital letters are handled in the widget, the rest go to the bot. */
  window.g = (action) => {
    if (root.className) return;
    ask(action == "R" ? lastRequest : action);
  };

  show(["w"]);
  // The first page of «Мощные»: filter p, page 0.
  ask("lp0");
}
