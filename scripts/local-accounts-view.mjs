// @ts-check
const profiles = [
  ["owner", "Владелец", "Авторство, черновики и все локальные материалы."],
  [
    "learner-with-access",
    "Ученик с доступом",
    "Учебные материалы и прогресс. Без авторских прав.",
  ],
  [
    "learner",
    "Ученик без доступа",
    "Обычный аккаунт без доступа к закрытым материалам.",
  ],
  ["guest", "Гость", "Просмотр без входа."],
];
/** @param {string} value */
function escape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Temporary semantic UI for #1641. Replace through #1642 after Storybook acceptance.
 * @param {{ choice: string; returnTo: string }} view */
export function localAccountsContent(view) {
  return `<main><h1>Аккаунт локального стенда</h1><p>Сейчас: <strong>${escape(profiles.find(([key]) => key === view.choice)?.[1] ?? "Гость")}</strong>.</p><p>Выбор сохранится в этом браузере. В новом контексте стенд откроется от владельца.</p><form method="post" action="/__local/accounts"><input type="hidden" name="returnTo" value="${escape(view.returnTo)}"><fieldset><legend>От чьего лица проверять Platform</legend>${profiles.map(([key = "", label = "", description = ""]) => `<label><input type="radio" name="choice" value="${key}"${key === view.choice ? " checked" : ""}><span><strong>${label}</strong><small>${description}</small></span></label>`).join("")}</fieldset><button type="submit">Выбрать аккаунт</button></form><p><a href="${escape(view.returnTo)}">Вернуться без изменений</a></p><p>Меняется только проверочная сессия. Контент, покупки и сохранённый прогресс остаются на месте.</p></main>`;
}
export const localAccountsStyles = `body{margin:0;font:16px/1.5 var(--font-body);color:var(--foreground);background:var(--background)}main{max-width:40rem;margin:3rem auto;padding:0 1.25rem}h1{font-size:1.75rem;line-height:1.2}fieldset{border:0;padding:0;margin:2rem 0 1.5rem}legend{font-weight:600;margin-bottom:.75rem}label{display:flex;align-items:flex-start;gap:.75rem;padding:.75rem 0;cursor:pointer}input[type=radio]{margin-top:.4rem;accent-color:var(--action)}small{display:block;font-size:.875rem}button{font:inherit;min-height:44px;padding:.5rem 1rem;border:0;border-radius:var(--radius);color:var(--primary-foreground);background:var(--primary);cursor:pointer}a{color:var(--action);text-underline-offset:.2em}:focus-visible{outline:3px solid var(--ring);outline-offset:3px}@media(max-width:480px){main{margin:1.5rem auto}}`;
/** @param {{ choice: string; returnTo: string }} view */
export function localAccountsPage(view) {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Аккаунт локального стенда</title><link rel="stylesheet" href="/__local/accounts/theme.css"><style>${localAccountsStyles}</style><body>${localAccountsContent(view)}</body></html>`;
}

export function localAccountsToolbarScript() {
  // Fetches a label only; no token, arbitrary Account id or authorization assertion enters the DOM.
  return `(() => {const mount=async()=>{if(document.getElementById('inside-local-account'))return;const response=await fetch('/__local/accounts',{cache:'no-store'});if(!response.ok)return;const doc=new DOMParser().parseFromString(await response.text(),'text/html');const label=doc.querySelector('main>p strong')?.textContent??'Гость';const host=document.createElement('aside');host.id='inside-local-account';host.setAttribute('aria-label','Локальный стенд');host.style.cssText='position:fixed;right:12px;bottom:80px;z-index:2147483647;max-width:calc(100vw - 24px)';const root=host.attachShadow({mode:'open'});root.innerHTML='<style>div{font:14px/1.4 var(--font-body);background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}a,button{font:inherit;color:var(--action);min-height:44px;display:inline-flex;align-items:center}button{background:none;border:0;text-decoration:underline;cursor:pointer}form{display:inline;margin:0}a:focus-visible,button:focus-visible{outline:3px solid var(--ring);outline-offset:2px}</style><div><span></span><a>Сменить</a><form method="post" action="/__local/accounts"><input type="hidden" name="choice" value="owner"><input type="hidden" name="returnTo"><button>К владельцу</button></form></div>';root.querySelector('span').textContent='Локально: '+label;root.querySelector('a').href='/__local/accounts?returnTo='+encodeURIComponent(location.pathname+location.search);root.querySelector('input[name=returnTo]').value=location.pathname+location.search;document.body.append(host);};if(document.readyState==='complete')void mount();else window.addEventListener('load',()=>void mount(),{once:true});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});})();`;
}
