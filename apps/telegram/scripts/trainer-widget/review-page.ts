import { TRAINER_WIDGET_TARGET_HEIGHT_PX } from "../../src/modules/trainer/widget/trainer-widget-limits.js";

export const reviewPage = `<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Приёмка Тренажёра</title>
<style>
body{margin:32px auto;padding:0 20px;max-width:1080px;font:16px/1.5 system-ui;color:#242424;background:#f4f4f2}
h1{font-size:28px;line-height:1.2;margin:0 0 12px}p{max-width:70ch}.layout{display:flex;gap:40px;align-items:flex-start;flex-wrap:wrap}.controls{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}select,button{font:inherit;padding:8px;border:1px solid #aaa;border-radius:6px;background:white;color:#242424}button{cursor:pointer}iframe{display:block;border:1px solid #aaa;border-radius:16px;max-width:100%;height:${String(TRAINER_WIDGET_TARGET_HEIGHT_PX)}px;background:white}ol{padding-left:24px;max-width:420px}li{margin-bottom:16px}.note{color:#626262;font-size:14px}#status{min-height:24px}@media(max-width:600px){body{margin:20px auto;padding:0 10px}.layout{gap:16px}h1{font-size:24px}}
</style>
<h1>Приёмка Тренажёра</h1>
<p>Настоящий виджет и серверные правила из PR. Вопросы синтетические, ответы сохраняются в отдельной временной базе. Браузер заменяет Telegram, сообщений ботам нет.</p>
<div class="controls">
<label>Тема <select id="theme"><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label>
<label>Ширина <select id="width"><option>320</option><option selected>390</option><option>430</option></select></label>
<button id="reset" type="button">Начать новым участником</button>
</div><p id="status" role="status"></p>
<div class="layout"><iframe title="Тренажёр" id="widget" width="390"></iframe>
<section><h2>Что проверить</h2><ol>
<li>Пройди «Проверить себя». Ответь верно, неверно и «Не знаю». После разбора нажимай «Дальше», после последнего ответа «К итогу».</li>
<li>Открой Вопрос дня, ответь и открой снова. Должен появиться твой прежний ответ с разбором.</li>
<li>Выбери тему и пройди раунд. В итоге должно быть её название.</li>
<li>Открой Прогресс. Должны измениться число ответов, Очки и Серия.</li>
<li>Открой Рейтинг. Участники с очками показаны автоматически, переключателя участия нет. Проверь обе вкладки и свою строку.</li>
<li>После ответа нажми «Оценить». Выбери лайк, замени дизлайком, затем сними его повторным нажатием. Карточки ответов должны остаться на месте.</li>
<li>Переключи тему и ширину 320. Текст и кнопки должны помещаться. Для чистого повторения нажми «Начать новым участником».</li>
</ol><p class="note">В синтетическом Банке верен вариант А; в каждом третьем вопросе верны А и Б. Это условные тексты для проверки интерфейса.</p>
<p class="note">Отдельно на телефоне в Telegram проверяются настоящий Bot API, время ответа, старые клиенты, время в нижнем углу и пересоздание виджета. Этот просмотр не заменяет эти критерии #2002.</p></section></div>
<script>
const frame=document.getElementById('widget'),theme=document.getElementById('theme'),width=document.getElementById('width'),status=document.getElementById('status');
function display(){frame.width=width.value;frame.style.colorScheme=theme.value;frame.src='/widget?theme='+theme.value;}
async function reset(){try{const r=await fetch('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw new Error('Не удалось создать участника');status.textContent='Новый участник готов. Прогресс начинается с нуля.';display();}catch(e){status.textContent=e.message;}}
window.addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;const height=event.data?.trainerWidgetHeight;if(typeof height==='number'&&Number.isFinite(height))frame.style.height=Math.max(50,Math.min(${String(TRAINER_WIDGET_TARGET_HEIGHT_PX)},height))+'px';});
theme.onchange=display;width.onchange=display;document.getElementById('reset').onclick=reset;reset();
</script></html>`;

/** No model of the Trainer lives here: requests go to the real server module. */
export function widgetPage(
  html: string,
  chatData: string,
  dark: boolean,
): string {
  // Telegram's media query follows the chat theme. A browser follows the OS, so this
  // boundary translates that media condition only; the widget's colours stay in its CSS.
  const themedHtml = html.replace(
    /@media\s*\(prefers-color-scheme:\s*dark\)/g,
    dark ? "@media all" : "@media not all",
  );
  const palette = dark
    ? ["#212121", "#ffffff", "#aaaaaa", "#2c2c2e"]
    : ["#ffffff", "#000000", "#707579", "#f1f1f4"];
  const theme = dark ? "dark" : "light";
  return `<!doctype html><html><meta charset="utf-8"><style>
:root{--tg-theme-bg-color:${palette[0]};--tg-theme-text-color:${palette[1]};--tg-theme-hint-color:${palette[2]};--tg-theme-secondary-bg-color:${palette[3]};--tg-color-scheme:${theme};--tg-text-font-size:15px;--tg-text-line-height:1.35;color-scheme:${theme}}
body{margin:8px 12px;background:${palette[0]};color:${palette[1]};font:15px/1.35 system-ui}
</style><script>
window.TelegramWidget={profile:1,colorScheme:${JSON.stringify(theme)},chatData:${JSON.stringify(chatData)},ready(){},onEvent(){},setResizeAnchor(){},
request:async(data)=>{const r=await fetch('/api/tap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});if(!r.ok)throw new Error('REVIEW_REQUEST_FAILED');return{result:await r.text()};}};
</script><body>${themedHtml}<script>new ResizeObserver(()=>parent.postMessage({trainerWidgetHeight:document.body.offsetHeight},location.origin)).observe(document.body);</script></body></html>`;
}
