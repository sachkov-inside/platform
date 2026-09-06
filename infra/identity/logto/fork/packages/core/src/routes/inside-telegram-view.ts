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

export const telegramSignInPage = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход через Telegram — Inside</title><style>[hidden]{display:none!important}body{font:18px/1.6 system-ui;background:#faf9f7;color:#252525;margin:0}main{max-width:460px;margin:8vh auto;padding:24px}a,button{display:inline-block;padding:12px 20px;border-radius:8px;background:#252525;color:white;text-decoration:none}p{margin:20px 0}#code{font-size:32px;letter-spacing:.15em}button{font:inherit;cursor:pointer}</style><main><h1>Вход через Telegram</h1><p>Уже есть аккаунт? Войдите по почте и подключите Telegram в кабинете. Отдельная регистрация не объединит аккаунты и покупки.</p><p>Если потеряете Telegram, вход может стать недоступен. Поддержка не гарантирует восстановление. Добавить первую почту к этому аккаунту пока нельзя.</p><p id="status" role="status">Загружаем запрос…</p><strong id="code"></strong><p><a id="bot" hidden target="_blank" rel="noreferrer">Открыть бота</a></p><p>Сверьте число в боте и подтвердите вход только для этой вкладки. Затем вернитесь сюда.</p><a href="/sign-in">Через почту</a></main><script src="/api/inside-telegram/script"></script></html>`;

export const telegramSignInScript = `let stopped=false;async function poll(){try{const r=await fetch('/api/inside-telegram/status',{cache:'no-store'});const s=await r.json();const copy={pending:'Ожидаем подтверждение в боте',approved:'Входим…',denied:'Вы отклонили вход. Можно начать заново.',expired:'Время вышло. Начните вход заново.',consumed:'Этот запрос уже использован. Начните вход заново.',disabled:'Вход через Telegram сейчас отключён.',unavailable:'Вход сейчас недоступен. Начните заново.'};document.getElementById('status').textContent=copy[s.status]||copy.unavailable;if(s.deepLink){const a=document.getElementById('bot');a.href=s.deepLink;a.hidden=false;document.getElementById('code').textContent=s.confirmationCode;}if(s.status==='approved'&&s.callback){stopped=true;location.replace(s.callback);}else if(s.status!=='pending'){stopped=true;document.getElementById('bot').hidden=true;}}catch{document.getElementById('status').textContent='Нет связи. Пробуем ещё раз…';}if(!stopped)setTimeout(poll,1500);}poll();`;
