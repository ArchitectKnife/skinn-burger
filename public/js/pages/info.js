// BURGER SKIN — поддержка, новости, Provably Fair, правила, приватность, 404.
import { state, html, raw, mount, $, api, num, bc, fdate, fday, ago, GAMES, img, avatar, empty, loader, head, tabs, notice, toast, busy, bindForm, page, go, on, setQuery, setNotFound, safeUrl } from '../core.js';
import { icon } from '../icons.js';
import { newsCard, NEWS_KIND, uploadImage, copy, betStatus } from './shared.js';

// ---------- Поддержка ----------
const stBadge = (t) => html`<span class="badge ${t.status === 'answered' ? 'ok' : t.status === 'closed' ? '' : t.status === 'pending' ? 'info' : 'warn'}">${t.statusName}</span>`;
function attachInput() {
  return html`<label class="btn ghost sm" style="cursor:pointer">${icon('paperclip')} Прикрепить скриншот<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-att hidden></label><span class="muted sm" data-attname></span>`;
}
function bindAttach(root, holder) {
  on(root, 'change', '[data-att]', async (e, t) => {
    const f = t.files?.[0]; if (!f) return;
    const lbl = $('[data-attname]', root);
    try { if (lbl) lbl.textContent = 'Загрузка…'; const r = await uploadImage(f, 'ticket'); holder.id = r.id; if (lbl) lbl.textContent = 'Прикреплено: ' + f.name; }
    catch (err) { holder.id = null; if (lbl) lbl.textContent = ''; toast(err.message || 'Не удалось загрузить файл', 'err'); }
    t.value = '';
  });
}
const opt = (map, cur) => Object.entries(map).map(([k, l]) => html`<option value="${k}" ${k === cur ? raw('selected') : ''}>${l}</option>`);

page('/support', async (ctx) => {
  const d = await api('/api/tickets');
  const open = d.tickets.filter((t) => t.status !== 'closed').length;
  mount(ctx.el, html`<div class="wrap">${head('Поддержка', 'Отвечаем на обращения каждый день', html`<a class="btn" href="/support/new">Новое обращение</a>`)}
    ${open >= 5 ? notice('У вас 5 открытых обращений — дождитесь ответа или закройте решённые.', 'warn') : ''}
    ${d.tickets.length ? html`<div class="tbl-wrap card"><table class="tbl"><thead><tr><th>№</th><th>Тема</th><th>Категория</th><th>Приоритет</th><th>Статус</th><th class="r">Обновлено</th></tr></thead><tbody>${d.tickets.map((t) => html`<tr data-href="/support/${t.id}" style="cursor:pointer"><td class="mono">#${t.id}</td><td><b>${t.subject}</b><div class="muted xs">сообщений: ${t.messages}</div></td><td>${t.categoryName}</td><td>${t.priorityName}</td><td>${stBadge(t)}</td><td class="r muted">${ago(t.updatedAt)}</td></tr>`)}</tbody></table></div>`
      : empty('У вас пока нет обращений. Если что-то пошло не так — напишите нам.', html`<a class="btn" href="/support/new">Создать обращение</a>`)}
    <div class="card mt-l prose"><h3>Перед обращением</h3><ul><li>Результат любого открытия или игры можно проверить на странице <a href="/fair">Provably Fair</a>.</li><li>Все операции с балансом — в <a href="/history?tab=ledger">истории</a>.</li><li>Укажите номер ставки или битвы — так мы поможем быстрее. Сотрудники никогда не спрашивают пароль.</li></ul></div></div>`);
  on(ctx.el, 'click', 'tr[data-href]', (e, t) => go(t.dataset.href));
}, { auth: true, title: 'Поддержка' });

page('/support/new', async (ctx) => {
  const d = await api('/api/tickets');
  const pri = { low: d.priorities.low, normal: d.priorities.normal, high: d.priorities.high };
  const att = { id: null };
  mount(ctx.el, html`<div class="wrap narrow">${head('Новое обращение', 'Опишите проблему как можно подробнее', html`<a class="btn ghost" href="/support">Мои обращения</a>`)}
    <form class="form card" data-new>
      <label class="fld"><span>Тема</span><input name="subject" required minlength="3" maxlength="120" placeholder="Коротко о сути"></label>
      <div class="form g2"><label class="fld"><span>Категория</span><select name="category" required>${opt(d.categories, ctx.q.get('category') || 'account')}</select></label>
      <label class="fld"><span>Приоритет</span><select name="priority">${opt(pri, 'normal')}</select></label></div>
      <label class="fld"><span>Сообщение</span><textarea name="body" rows="7" required minlength="5" maxlength="5000" placeholder="Что произошло? Укажите номер ставки, битвы или заявки, если есть.">${ctx.q.get('text') || ''}</textarea></label>
      <div class="row between" style="flex-wrap:wrap;gap:10px"><div class="row gap">${attachInput()}</div><button class="btn">Отправить</button></div>
    </form></div>`);
  bindAttach(ctx.el, att);
  bindForm($('[data-new]', ctx.el), async (f) => {
    const r = await api('/api/tickets', { subject: f.subject, category: f.category, priority: f.priority, body: f.body, attachment: att.id || undefined });
    toast('Обращение #' + r.ticket.id + ' создано', 'ok'); go('/support/' + r.ticket.id, { replace: true });
  });
}, { auth: true, title: 'Новое обращение' });

export function threadHtml(t, meId) {
  return html`<div class="chat">${t.thread.map((m) => html`<div class="msg ${m.staff ? 'staff' : ''} ${m.user?.id === meId && !m.staff ? 'me' : ''}">
    <div class="msg-h">${avatar(m.user)}<b>${m.staff ? (m.user?.nickname || 'Поддержка') + ' · поддержка' : m.user?.nickname || 'Игрок'}</b><span class="muted xs">${fdate(m.createdAt)}</span></div>
    <div style="white-space:pre-wrap">${m.body}</div>${m.attachment ? html`<a href="${safeUrl(m.attachment)}" target="_blank" rel="noopener"><img class="att" src="${safeUrl(m.attachment)}" alt="Вложение"></a>` : ''}</div>`)}</div>`;
}
page('/support/:id', async (ctx) => {
  const att = { id: null };
  const load = async () => {
    const { ticket: t } = await api('/api/tickets/' + encodeURIComponent(ctx.params.id));
    if (!ctx.alive()) return;
    const closed = t.status === 'closed';
    mount(ctx.el, html`<div class="wrap narrow">${head('#' + t.id + ' · ' + t.subject, '', html`<a class="btn ghost" href="/support">Все обращения</a>`)}
      <div class="card"><div class="row gap" style="flex-wrap:wrap">${stBadge(t)}<span class="badge">${t.categoryName}</span><span class="badge">Приоритет: ${t.priorityName}</span><span class="muted sm">Создано ${fdate(t.createdAt)}${t.assignee ? ' · отвечает ' + t.assignee.nickname : ''}</span>
        <span class="grow"></span>${closed ? html`<button class="btn ghost sm" data-reopen>Открыть снова</button>` : html`<button class="btn ghost sm" data-close-t>Закрыть обращение</button>`}</div></div>
      <div class="card mt">${threadHtml(t, state.me.id)}</div>
      ${closed ? notice('Обращение закрыто. Если вопрос не решён — откройте его снова.') : html`<form class="form card mt" data-reply><label class="fld"><span>Ответ</span><textarea name="body" rows="4" required maxlength="5000" placeholder="Напишите сообщение"></textarea></label><div class="row between" style="flex-wrap:wrap;gap:10px"><div class="row gap">${attachInput()}</div><button class="btn">Отправить</button></div></form>`}</div>`);
    const f = $('[data-reply]', ctx.el);
    if (f) bindForm(f, async (d) => { await api(`/api/tickets/${t.id}/messages`, { body: d.body, attachment: att.id || undefined }); att.id = null; await load(); });
    const chat = $('.chat', ctx.el); if (chat) chat.scrollTop = chat.scrollHeight;
  };
  bindAttach(ctx.el, att);
  on(ctx.el, 'click', '[data-close-t]', (e, t) => busy(t, async () => { await api(`/api/tickets/${ctx.params.id}/close`, {}); toast('Обращение закрыто', 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-reopen]', (e, t) => busy(t, async () => { await api(`/api/tickets/${ctx.params.id}/reopen`, {}); toast('Обращение снова открыто', 'ok'); await load(); }));
  ctx.on('notify', () => load().catch(() => {}));
  ctx.every(20000, () => load().catch(() => {}));
  await load();
}, { auth: true, title: 'Обращение' });

// ---------- Новости ----------
page('/news', async (ctx) => {
  let kind = ctx.q.get('kind') || '';
  const load = async () => {
    const d = await api('/api/news' + (kind ? '?kind=' + kind : ''));
    if (!ctx.alive()) return;
    mount(ctx.el, html`<div class="wrap">${head('Новости и акции', 'Обновления BURGER SKIN, новые кейсы и промокоды')}
      ${tabs([['', 'Все'], ...Object.entries(NEWS_KIND)], kind)}
      <div class="grid g3 mt">${d.news.map(newsCard)}</div>${d.news.length ? '' : empty('Публикаций пока нет.')}</div>`);
  };
  on(ctx.el, 'click', '[data-tab]', (e, t) => { kind = t.dataset.tab; setQuery({ kind }); load().catch(() => {}); });
  await load();
}, { title: 'Новости' });

// Безопасный рендер текста новости: абзацы, списки «- », заголовки «## ». HTML не интерпретируется.
export function richText(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    if (!lines.length) return '';
    if (lines.every((l) => /^\s*[-*•] /.test(l))) return html`<ul>${lines.map((l) => html`<li>${l.replace(/^\s*[-*•] /, '')}</li>`)}</ul>`;
    if (/^#{1,3} /.test(lines[0]) && lines.length === 1) return html`<h3>${lines[0].replace(/^#{1,3} /, '')}</h3>`;
    return html`<p>${lines.map((l, i) => html`${i ? raw('<br>') : ''}${l}`)}</p>`;
  });
}
page('/news/:id', async (ctx) => {
  const { news: n } = await api('/api/news/' + encodeURIComponent(ctx.params.id));
  mount(ctx.el, html`<div class="wrap narrow"><a class="muted sm" href="/news">← Все новости</a>
    <article class="card mt prose">${n.image ? html`<div class="mb" style="border-radius:12px;overflow:hidden;max-height:340px">${img(n.image, '', n.title)}</div>` : ''}
      <div class="row gap"><span class="badge ${n.kind === 'promo' ? 'warn' : n.kind === 'update' ? 'info' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span><span class="muted sm">${fday(n.created_at)}</span>${n.published ? '' : html`<span class="badge err">Черновик</span>`}</div>
      <h1 class="mt">${n.title}</h1>${richText(n.body)}</article></div>`);
}, { title: 'Новость' });

// ---------- Provably Fair ----------
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function floatsLocal(serverSeed, clientSeed, nonce, count) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = []; let cursor = 0;
  while (out.length < count) {
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor++}`)));
    for (let i = 0; i < 32 && out.length < count; i += 4) out.push(h[i] / 256 + h[i + 1] / 65536 + h[i + 2] / 16777216 + h[i + 3] / 4294967296);
  }
  return out;
}
const floatsHtml = (fl) => html`<div class="chips">${fl.map((x, i) => html`<span class="chip mono" title="число ${i + 1}">${x.toFixed(10)}</span>`)}</div>`;

page('/fair', async (ctx) => {
  const bet = ctx.q.get('bet');
  const load = async () => {
    const d = state.me ? await api('/api/fair') : null;
    let b = null;
    if (bet && state.me) b = await api('/api/fair/bet/' + encodeURIComponent(bet)).catch((e) => ({ error: e.message }));
    if (!ctx.alive()) return;
    mount(ctx.el, html`<div class="wrap">${head('Provably Fair', 'Каждый результат можно проверить самостоятельно')}
      ${b ? (b.error ? notice(b.error, 'err') : html`<div class="card mb"><div class="sec-head"><h2>Ставка #${b.bet.id} · ${GAMES[b.bet.game] || b.bet.game}</h2>${betStatus(b.bet)}</div>
        <div class="kv"><span>Дата</span><span>${fdate(b.bet.createdAt)}</span><span>Ставка</span><span>${bc(b.bet.amount)}</span><span>Выплата</span><span>${bc(b.bet.payout || 0)}</span>
          <span>Хеш server seed</span><span class="mono xs" style="word-break:break-all">${b.bet.serverHash || '—'}</span><span>Client seed</span><span class="mono">${b.bet.clientSeed || '—'}</span><span>Nonce</span><span class="mono">${b.bet.nonce ?? '—'}</span>
          <span>Server seed</span><span class="mono xs" style="word-break:break-all">${b.bet.serverSeed || 'скрыт до смены сида'}</span></div>
        ${b.floats ? html`<p class="sm mt">Случайные числа этой ставки (первые 8 из ${b.floats.length}):</p>${floatsHtml(b.floats.slice(0, 8))}<button class="btn ghost sm mt" data-fill="${b.bet.id}">Проверить в браузере</button>` : notice('Чтобы проверить эту ставку, смените сид ниже — тогда текущий server seed будет раскрыт.')}</div>`) : ''}
      <div class="grid g2">
        <div class="card"><div class="sec-head"><h2>Ваши текущие сиды</h2></div>
          ${d ? html`<div class="kv"><span>Хеш server seed</span><span class="mono xs" style="word-break:break-all">${d.active.serverHash}</span><span>Client seed</span><span class="mono">${d.active.clientSeed}</span><span>Nonce</span><span class="mono">${d.active.nonce}</span></div>
            <form class="inline-form mt" data-rotate><label class="fld"><span>Новый client seed (необязательно)</span><input name="clientSeed" maxlength="64" pattern="[A-Za-z0-9_\-]{1,64}" placeholder="латиница, цифры, - и _"></label><button class="btn">Сменить сид</button></form>
            <p class="muted sm">При смене сида текущий server seed раскрывается, и все ставки на нём становятся проверяемыми.</p>`
            : notice(html`<a href="/login?next=/fair">Войдите</a>, чтобы увидеть свои сиды. Проверка ниже доступна всем.`)}
        </div>
        <div class="card"><div class="sec-head"><h2>Проверка результата</h2></div>
          <form class="form" data-verify>
            <label class="fld"><span>Server seed</span><input name="serverSeed" required maxlength="128" class="mono"></label>
            <div class="form g2"><label class="fld"><span>Client seed</span><input name="clientSeed" maxlength="256" class="mono"></label><label class="fld"><span>Nonce</span><input name="nonce" required maxlength="64" class="mono"></label></div>
            <label class="fld"><span>Сколько чисел показать</span><input name="count" type="number" min="1" max="64" value="8"></label>
            <button class="btn">Проверить</button>
          </form><div data-vres class="mt"></div></div>
      </div>
      ${d?.revealed?.length ? html`<div class="card mt-l"><div class="sec-head"><h2>Раскрытые сиды</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Server seed</th><th>Хеш</th><th>Client seed</th><th class="r">Ставок</th><th class="r">Раскрыт</th></tr></thead><tbody>${d.revealed.map((s) => html`<tr><td class="mono xs" style="word-break:break-all">${s.server_seed} <button class="btn ghost sm" data-copy="${s.server_seed}">${icon('copy')}</button></td><td class="mono xs" style="word-break:break-all">${s.server_hash}</td><td class="mono">${s.client_seed}</td><td class="r">${num(s.nonce)}</td><td class="r muted">${fdate(s.revealed_at)}</td></tr>`)}</tbody></table></div></div>` : ''}
      <div class="card mt-l prose"><h3>Как работает честность</h3>
        <ol><li>До первой ставки сервер генерирует случайный <b>server seed</b> (криптографически стойкий ГСЧ) и показывает вам только его SHA-256 хеш.</li>
        <li>Вы можете задать свой <b>client seed</b>. Каждая ставка увеличивает <b>nonce</b> на 1.</li>
        <li>Случайные числа ставки: HMAC-SHA256(ключ = server seed, сообщение = «client seed:nonce:номер блока»). Каждые 4 байта дают число от 0 до 1.</li>
        <li>Результат определяется этими числами: для кейса — позиция в таблице шансов, для апгрейда — сравнение с шансом, для Mines и Towers — расстановка поля.</li>
        <li>После смены сида старый server seed раскрывается: вы можете убедиться, что его хеш совпадает с показанным заранее, и пересчитать любую ставку.</li></ol>
        <p>Раунды Crash, Double, Roulette и Jackpot используют общий сид раунда: его хеш публикуется до приёма ставок, а сам сид — в истории раунда после его завершения. Шансы не меняются после ставки.</p></div>
    </div>`);
    const fr = $('[data-rotate]', ctx.el);
    if (fr) bindForm(fr, async (f) => { await api('/api/fair/rotate', { clientSeed: f.clientSeed || undefined }); toast('Сид сменён, предыдущий server seed раскрыт', 'ok'); await load(); });
    bindForm($('[data-verify]', ctx.el), async (f) => {
      const count = Math.min(64, Math.max(1, Number(f.count) || 8));
      const [r, localHash, localFl] = await Promise.all([api('/api/fair/verify', { serverSeed: f.serverSeed, clientSeed: f.clientSeed || '', nonce: f.nonce, count }), sha256hex(f.serverSeed), floatsLocal(f.serverSeed, f.clientSeed || '', f.nonce, count)]);
      const same = r.hash === localHash && r.floats.every((x, i) => Math.abs(x - localFl[i]) < 1e-12);
      mount($('[data-vres]', ctx.el), html`<div class="kv"><span>SHA-256(server seed)</span><span class="mono xs" style="word-break:break-all">${r.hash}</span></div><p class="sm mt">Случайные числа:</p>${floatsHtml(r.floats)}${notice(same ? 'Расчёт в вашем браузере совпал с серверным.' : 'Расчёт в браузере не совпал — проверьте введённые данные.', same ? 'ok' : 'err')}`);
    });
    on(ctx.el, 'click', '[data-fill]', () => {
      const form = $('[data-verify]', ctx.el); if (!form || !b?.bet) return;
      form.serverSeed.value = b.bet.serverSeed || ''; form.clientSeed.value = b.bet.clientSeed || ''; form.nonce.value = b.bet.nonce ?? ''; form.requestSubmit();
    });
  };
  on(ctx.el, 'click', '[data-copy]', (e, t) => copy(t.dataset.copy));
  await load();
}, { title: 'Provably Fair' });

// ---------- Правила и политика ----------
const siteName = () => state.site?.name || 'BURGER SKIN';
page('/rules', async (ctx) => {
  mount(ctx.el, html`<div class="wrap narrow">${head('Правила сайта', 'Пожалуйста, прочитайте перед использованием')}<div class="card prose">
    <h3>1. Общие положения</h3><p>${siteName()} — развлекательная платформа в тематике CS2. Используя сайт, вы соглашаетесь с настоящими правилами. Сайт не связан с Valve Corporation и не одобрен ею. Counter-Strike и Steam — товарные знаки Valve Corporation.</p>
    <h3>2. Возраст и аккаунт</h3><ul><li>Регистрация доступна только лицам старше 18 лет.</li><li>Один человек — один аккаунт. Мультиаккаунты и автоматизация действий запрещены.</li><li>Вы отвечаете за сохранность пароля. Сотрудники никогда не запрашивают пароль и коды.</li></ul>
    <h3>3. Баланс и предметы</h3><ul><li>Баланс аккаунта ведётся в рублях (₽). Без подключённых и одобренных платёжных провайдеров пополнение и вывод средств недоступны.</li><li>Предметы в инвентаре — внутренние записи сайта. Вывод в Steam доступен только если он включён администрацией; статус виден на странице <a href="/withdraw">Вывод</a>.</li><li>Оценочная стоимость предметов может меняться при обновлении цен из источника.</li></ul>
    <h3>4. Честность</h3><p>Все результаты определяются на сервере и проверяются на странице <a href="/fair">Provably Fair</a>. Шансы каждого кейса опубликованы на его странице и не меняются после ставки.</p>
    <h3>5. Запрещено</h3><ul><li>Использовать ошибки сайта — о них нужно сообщать в <a href="/support">поддержку</a>.</li><li>Оскорбления, спам и мошенничество, в том числе в никнеймах и аватарах.</li><li>Передача аккаунта третьим лицам.</li></ul>
    <h3>6. Ограничения</h3><p>При нарушении правил администрация может ограничить доступ к функциям или заблокировать аккаунт. Каждое такое действие сотрудника фиксируется в журнале аудита с указанием причины. Обжаловать решение можно через поддержку.</p>
    <h3>7. Ответственная игра</h3><p>Играйте ради удовольствия. Если вы чувствуете, что теряете контроль, напишите в поддержку — мы ограничим доступ к играм на нужный срок.</p>
  </div></div>`);
}, { title: 'Правила' });

page('/privacy', async (ctx) => {
  mount(ctx.el, html`<div class="wrap narrow">${head('Политика конфиденциальности', 'Какие данные мы храним и зачем')}<div class="card prose">
    <h3>Какие данные мы собираем</h3><ul><li>Данные аккаунта: логин, email, никнейм, аватар, SteamID и имя профиля Steam (если вы его привязали).</li><li>Пароль хранится только в виде хеша Argon2id — мы не знаем ваш пароль.</li><li>Игровая история: открытия, ставки, предметы и операции с балансом.</li><li>Технические данные сеанса: IP-адрес, браузер, время входа — для защиты аккаунта от взлома.</li><li>Обращения в поддержку и приложенные изображения.</li></ul>
    <h3>Зачем</h3><p>Данные используются только для работы аккаунта, истории, поддержки, защиты от мошенничества и выполнения требований закона. Мы не продаём данные третьим лицам.</p>
    <h3>Cookies</h3><p>Используются только необходимые cookies: сессия (HttpOnly, SameSite), защита от CSRF и временный ключ входа через Steam. Рекламных и сторонних трекеров нет.</p>
    <h3>Сторонние сервисы</h3><p>При входе через Steam вы переходите на сайт Steam; мы получаем только ваш SteamID и публичные данные профиля. Изображения предметов могут загружаться с CDN Steam.</p>
    <h3>Ваши права</h3><ul><li>Изменить данные и скрыть профиль — в <a href="/settings">настройках</a>.</li><li>Завершить все сеансы — там же.</li><li>Запросить выгрузку или удаление данных — через <a href="/support/new?category=account">поддержку</a>.</li></ul>
  </div></div>`);
}, { title: 'Политика конфиденциальности' });

// ---------- 404 ----------
setNotFound(async (ctx) => {
  mount(ctx.el, html`<div class="wrap"><div class="nf"><b>404</b><h2>Такой страницы нет в меню</h2><p class="muted">Возможно, ссылка устарела или страница была перемещена.</p>
    <div class="row gap mt" style="justify-content:center;flex-wrap:wrap"><a class="btn" href="/">На главную</a><a class="btn ghost" href="/cases">Кейсы</a><a class="btn ghost" href="/games">Игры</a><a class="btn ghost" href="/support">Поддержка</a></div></div></div>`);
});
