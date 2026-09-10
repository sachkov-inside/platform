import { telegramSignInTheme } from './inside-telegram-theme.js';

export interface InsideTelegramPresentation {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'disabled' | 'unavailable';
  requestRef?: string;
  deepLink?: string;
  confirmationCode?: string;
  callback?: string;
}

export type InsideTelegramView = {
  status: InsideTelegramPresentation['status'] | 'loading' | 'reconnecting';
  deepLink?: string;
};

// Also serialized into the identity-origin script: keep this function self-contained.
export function renderTelegramSignInContent(view: InsideTelegramView): string {
  const copy = {
    loading: 'Готовим вход…',
    pending: 'Подтвердите вход в Telegram.',
    approved: 'Вход подтверждён. Возвращаемся на сайт…',
    denied: 'Вы отменили вход. Можно попробовать снова.',
    expired: 'Время ожидания вышло. Начните вход заново.',
    consumed: 'Этот запрос уже использован. Начните вход заново.',
    disabled: 'Вход через Telegram сейчас отключён.',
    unavailable: 'Не удалось начать вход. Попробуйте ещё раз.',
    reconnecting: 'Нет связи. Пробуем ещё раз…',
  };
  const status = Object.hasOwn(copy, view.status) ? view.status : 'unavailable';
  const waiting = status === 'pending';
  const busy = waiting || status === 'loading' || status === 'approved';
  let deepLink = '';
  if (waiting && view.deepLink) {
    try {
      const url = new URL(view.deepLink);
      if (url.protocol === 'https:' && url.hostname === 't.me' && !url.username && !url.password) {
        deepLink = url.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
      }
    } catch { /* An invalid link is never an actionable control. */ }
  }
  return `<div class="inside-telegram-brand" aria-label="Sachkov Inside">sachkov<span>inside</span></div>
    <div class="inside-telegram-content">
      <div class="inside-telegram-symbol" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="m21 3-7.1 18-4-7-7-4L21 3Zm0 0L9.9 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <h1>Вход через Telegram</h1>
      <p class="inside-telegram-status" role="status" aria-live="polite" aria-atomic="true">${copy[status]}</p>
      <div class="inside-telegram-actions">
        ${deepLink ? `<a class="inside-telegram-button" id="bot" href="${deepLink}" target="_blank" rel="noopener noreferrer">Открыть бота</a>` : busy ? '<span class="inside-telegram-progress" aria-hidden="true"></span>' : '<a class="inside-telegram-button" id="alternative" href="/sign-in">Вернуться ко входу</a>'}
      </div>
    </div>`;
}

export const telegramSignInStyles = `${telegramSignInTheme}
.inside-telegram,.inside-telegram *{box-sizing:border-box}
.inside-telegram{margin:0;min-height:100svh;padding:32px 20px;display:grid;place-items:center;background:var(--background);color:var(--foreground);font:16px/1.5 'Inside Manrope',system-ui,sans-serif;color-scheme:light}
.inside-telegram main{width:100%;max-width:540px;min-height:480px;padding:36px 48px 48px;border:1px solid var(--border);border-radius:16px;background:var(--card);box-shadow:var(--elevation-card)}
.inside-telegram-brand{font-size:18px;font-weight:500;letter-spacing:-.7px;line-height:28px}
.inside-telegram-brand span{font-weight:800;margin-left:4px}
.inside-telegram-content{padding-top:52px;text-align:center}
.inside-telegram-symbol{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 24px;border-radius:20px;background:#2aabee;color:#fff}
.inside-telegram h1{margin:0;font:700 26px/1.3 'Inside Manrope',system-ui,sans-serif;letter-spacing:-.8px}
.inside-telegram-status{min-height:48px;margin:16px 0 24px;color:var(--muted-foreground);font-size:15px;line-height:24px;text-wrap:balance}
.inside-telegram-actions{height:52px;display:flex;align-items:center;justify-content:center}
.inside-telegram-button{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:12px 16px;border:1px solid transparent;border-radius:10px;background:var(--primary);color:var(--primary-foreground);font-weight:650;font-size:15px;line-height:24px;text-decoration:none}
.inside-telegram-button:hover{filter:brightness(1.15)}
.inside-telegram #bot{background:#087eaf;color:#fff}
.inside-telegram #bot:hover{background:#076b95;filter:none}
.inside-telegram-button:focus-visible{outline:3px solid var(--ring);outline-offset:4px}
.inside-telegram-progress{width:22px;height:22px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:inside-telegram-spin 1s linear infinite}
@keyframes inside-telegram-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.inside-telegram-progress{animation:none}}
@media(max-width:580px){.inside-telegram{padding:0;display:block}.inside-telegram main{min-height:100svh;padding:28px 24px max(32px,env(safe-area-inset-bottom));border:0;border-radius:0;box-shadow:none;background:var(--background)}.inside-telegram-content{padding-top:72px}.inside-telegram h1{font-size:24px}}
@media(max-height:600px){.inside-telegram-content{padding-top:28px}}
@media(forced-colors:active){.inside-telegram-button{border-color:ButtonText}.inside-telegram-button:focus-visible{outline-color:Highlight}}
`;

export function renderTelegramSignInPage(view: InsideTelegramView): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Вход через Telegram — Inside</title><style>${telegramSignInStyles}</style></head><body class="inside-telegram"><main>${renderTelegramSignInContent(view)}</main></body></html>`;
}

export const telegramSignInPage = renderTelegramSignInPage({ status: 'loading' }).replace('</body>', '<script src="/api/inside-telegram/script"></script></body>');

export const pollIntervalMilliseconds = 1500;
const statusRequestTimeoutMilliseconds = 8000;
export const telegramSignInScript = `
const render = ${renderTelegramSignInContent.toString()};
const main = document.querySelector('main');
let previousContent = main.innerHTML;
function present(view) {
  const content = render(view);
  if (content === previousContent) return;
  const focusedId = document.activeElement?.id;
  const next = document.createElement('template');
  next.innerHTML = content;
  // Keep the live region mounted so assistive technology hears state changes.
  main.querySelector('[role="status"]').textContent = next.content.querySelector('[role="status"]').textContent;
  main.querySelector('.inside-telegram-actions').replaceChildren(...next.content.querySelector('.inside-telegram-actions').childNodes);
  previousContent = content;
  if (focusedId) (document.getElementById(focusedId) || document.getElementById('alternative') || document.getElementById('bot'))?.focus();
}
async function poll() {
  let stopped = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ${statusRequestTimeoutMilliseconds});
  try {
    const response = await fetch('/api/inside-telegram/status', { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Status unavailable');
    const state = await response.json();
    present(state);
    if (state.status === 'approved' && state.callback) {
      stopped = true;
      location.replace(state.callback);
    } else if (state.status !== 'pending') {
      stopped = true;
    }
  } catch {
    present({ status: 'reconnecting' });
  } finally {
    clearTimeout(timeout);
  }
  if (!stopped) setTimeout(poll, ${pollIntervalMilliseconds});
}
poll();
`;
