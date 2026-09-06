/**
 * Temporary semantic UI for https://github.com/sachkov-inside/platform/issues/299.
 * Replace through https://github.com/sachkov-inside/platform/issues/303 after Storybook acceptance.
 */
export interface InsideTelegramPresentation {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'disabled' | 'unavailable';
  requestRef?: string;
  deepLink?: string;
  confirmationCode?: string;
  callback?: string;
}

export const telegramSignInPage = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход через Telegram — Inside</title><style>[hidden]{display:none!important}body{font:16px/1.5 system-ui;background:#faf9f7;color:#252525;margin:0}main{max-width:360px;margin:12vh auto;padding:24px;text-align:center}h1{font-size:24px;line-height:1.3;margin:0 0 24px}#bot{display:block;padding:14px 20px;border-radius:8px;background:#252525;color:white;text-decoration:none;font-weight:600}p{margin:16px 0;color:#666}#alternative{color:inherit;text-underline-offset:3px}a:focus-visible{outline:3px solid #2879d0;outline-offset:4px}</style><main><h1>Вход через Telegram</h1><a id="bot" hidden target="_blank" rel="noreferrer">Открыть бота</a><p id="status" role="status">Загружаем…</p><a id="alternative" hidden href="/sign-in">Через почту</a></main><script src="/api/inside-telegram/script"></script></html>`;

export const telegramSignInScript = `let stopped=false;async function poll(){try{const r=await fetch('/api/inside-telegram/status',{cache:'no-store'});const s=await r.json();const copy={pending:'Подтвердите вход в Telegram',approved:'Входим…',denied:'Вы отклонили вход.',expired:'Время вышло. Начните вход заново.',consumed:'Этот запрос уже использован. Начните вход заново.',disabled:'Вход через Telegram сейчас отключён.',unavailable:'Вход сейчас недоступен. Начните заново.'};document.getElementById('status').textContent=copy[s.status]||copy.unavailable;if(s.deepLink){const a=document.getElementById('bot');a.href=s.deepLink;a.hidden=false;}if(s.status==='approved'&&s.callback){stopped=true;location.replace(s.callback);}else if(s.status!=='pending'){stopped=true;document.getElementById('bot').hidden=true;document.getElementById('alternative').hidden=false;}}catch{document.getElementById('status').textContent='Нет связи. Пробуем ещё раз…';}if(!stopped)setTimeout(poll,1500);}poll();`;
