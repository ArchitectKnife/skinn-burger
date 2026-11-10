// BURGER SKIN — вход и регистрация, баланс, история, поддержка, новости, Provably Fair, правила, 404.
import { state, html, raw, mount, $, api, num, bc, fdate, fday, ago, LEDGER, GAMES, img, itemCard, userLink, avatar, empty, loader, head, tabs, notice, toast, modal, confirmBox, busy, bindForm, page, go, on, setQuery, setBalance, refreshMe, renderHeader, pager, setNotFound, safeUrl, toCents, rub } from '../core.js';
import { icon } from '../icons.js';
import './info.js';
import { betsTable, newsCard, NEWS_KIND, stat, uploadImage, copy } from './shared.js';

const safeNext = (n) => (n && /^\/(?!\/)/.test(n) && !/^\/(login|register|reset|forgot)/.test(n) ? n : '/');
const authWrap = (title, sub, body) => html`<div class="wrap narrow" style="max-width:480px"><div class="card pad-xl"><div class="center mb"><img src="/img/brand/logo.svg" alt="BURGER SKIN" style="height:56px"><h1 class="mt">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>${body}</div></div>`;
const steamBtn = (href, label) => html`<a class="btn steam" style="width:100%;justify-content:center" href="${href}">${label}</a><div class="center muted sm mt mb">или</div>`;
const afterAuth = (user, next) => { state.me = user; renderHeader(); toast('Добро пожаловать, ' + user.nickname + '!', 'ok'); go(safeNext(next), { replace: true }); };

// ---------- Вход ----------
page('/login', async (ctx) => {
  const next = ctx.q.get('next') || '/';
  if (state.me) return go(safeNext(next), { replace: true });
  const opts = await api('/api/auth/options').catch(() => ({}));
  mount(ctx.el, authWrap('Вход в аккаунт', 'Рады видеть вас снова в BURGER SKIN', html`
    ${ctx.q.get('error') ? notice(ctx.q.get('error'), 'err') : ''}
    ${opts.steam ? steamBtn('/api/auth/steam', 'Войти через Steam') : ''}
    <form class="form" data-login>
      <label class="fld"><span>Логин или email</span><input name="login" required maxlength="120" autocomplete="username" autofocus></label>
      <label class="fld"><span>Пароль</span><input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
      <div class="row between sm"><a href="/forgot">Забыли пароль?</a><a href="/register${next !== '/' ? '?next=' + encodeURIComponent(next) : ''}">Создать аккаунт</a></div>
      <button class="btn" style="width:100%">Войти</button>
    </form>`));
  bindForm($('[data-login]', ctx.el), async (f) => { const r = await api('/api/auth/login', { login: String(f.login).trim(), password: f.password }); afterAuth(r.user, next); });
}, { title: 'Вход' });

// ---------- Регистрация ----------
page('/register', async (ctx) => {
  const next = ctx.q.get('next') || '/';
  if (state.me) return go(safeNext(next), { replace: true });
  const ref = String(ctx.q.get('ref') || localStorage.getItem('bs_ref') || '').replace(/[^A-Z0-9]/gi, '').slice(0, 20);
  if (ref) localStorage.setItem('bs_ref', ref);
  const opts = await api('/api/auth/options').catch(() => ({}));
  if (opts.registration === false) return mount(ctx.el, authWrap('Регистрация', '', notice('Регистрация временно закрыта администрацией. Попробуйте позже.', 'warn')));
  mount(ctx.el, authWrap('Регистрация', 'Создайте аккаунт за минуту', html`
    ${ref ? notice(html`Вы регистрируетесь по приглашению — код <b class="mono">${ref}</b>. Приветственный бонус начислится автоматически.`, 'ok') : ''}
    ${opts.steam ? steamBtn('/api/auth/steam' + (ref ? '?ref=' + ref : ''), 'Зарегистрироваться через Steam') : ''}
    <form class="form" data-reg>
      <label class="fld"><span>Логин</span><input name="login" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_.\-]+" autocomplete="username"><small class="muted">Латиница, цифры, точка, дефис, подчёркивание</small></label>
      <label class="fld"><span>Email</span><input name="email" type="email" required maxlength="120" autocomplete="email"></label>
      <label class="fld"><span>Пароль</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"><small class="muted">Не менее 8 символов, буквы и цифры</small></label>
      <label class="fld"><span>Повторите пароль</span><input name="repeat" type="password" required autocomplete="new-password"></label>
      <label class="check"><input type="checkbox" name="agree" required><span>Мне исполнилось 18 лет, я принимаю <a href="/rules" target="_blank">правила</a> и <a href="/privacy" target="_blank">политику конфиденциальности</a></span></label>
      <button class="btn" style="width:100%">Создать аккаунт</button>
      <p class="center sm">Уже есть аккаунт? <a href="/login">Войти</a></p>
    </form>`));
  bindForm($('[data-reg]', ctx.el), async (f) => {
    if (f.password !== f.repeat) throw new Error('Пароли не совпадают');
    const r = await api('/api/auth/register', { login: String(f.login).trim(), email: String(f.email).trim(), password: f.password, agree: !!f.agree, ref: ref || undefined });
    localStorage.removeItem('bs_ref'); afterAuth(r.user, next);
  });
}, { title: 'Регистрация' });
page('/r/:code', (ctx) => go('/register?ref=' + encodeURIComponent(ctx.params.code), { replace: true }), { title: 'Приглашение' });

// ---------- Восстановление пароля ----------
page('/forgot', async (ctx) => {
  const opts = await api('/api/auth/options').catch(() => ({}));
  mount(ctx.el, authWrap('Восстановление пароля', 'Мы отправим ссылку для смены пароля на ваш email', html`
    ${opts.mail === false ? notice(html`Отправка писем сейчас не настроена на сервере. Если вы не можете войти, напишите в поддержку с другого аккаунта или по контактам на странице <a href="/rules">Правила</a>.`, 'warn') : ''}
    <form class="form" data-forgot><label class="fld"><span>Email аккаунта</span><input name="email" type="email" required maxlength="120" autocomplete="email"></label>
      <button class="btn" style="width:100%" ${opts.mail === false ? raw('disabled') : ''}>Отправить ссылку</button><p class="center sm"><a href="/login">Вернуться ко входу</a></p></form><div data-done></div>`));
  bindForm($('[data-forgot]', ctx.el), async (f, form) => {
    await api('/api/auth/forgot', { email: String(f.email).trim() });
    form.remove(); mount($('[data-done]', ctx.el), notice('Если аккаунт с таким email существует, мы отправили на него ссылку. Она действует 1 час. Проверьте папку «Спам».', 'ok'));
  });
}, { title: 'Восстановление пароля' });

page('/reset', async (ctx) => {
  const token = ctx.q.get('token') || '';
  if (!token) return mount(ctx.el, authWrap('Смена пароля', '', html`${notice('Ссылка неполная или устарела. Запросите новую.', 'err')}<a class="btn mt" href="/forgot">Запросить ссылку</a>`));
  mount(ctx.el, authWrap('Новый пароль', 'Придумайте надёжный пароль для аккаунта', html`<form class="form" data-reset>
    <label class="fld"><span>Новый пароль</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label>
    <label class="fld"><span>Повторите пароль</span><input name="repeat" type="password" required autocomplete="new-password"></label>
    <button class="btn" style="width:100%">Сохранить пароль</button></form>`));
  bindForm($('[data-reset]', ctx.el), async (f) => {
    if (f.password !== f.repeat) throw new Error('Пароли не совпадают');
    await api('/api/auth/reset', { token, password: f.password });
    toast('Пароль изменён — войдите с новым паролем', 'ok'); go('/login', { replace: true });
  });
}, { title: 'Смена пароля' });

// ---------- Баланс, пополнение, вывод ----------
const finBadge = (s) => html`<span class="badge ${s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'err' : s.status === 'pending' ? 'warn' : ''}">${s.statusName}</span>`;
function requestsTable(rows) {
  if (!rows.length) return empty('Заявок на пополнение или вывод пока не было.');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>№</th><th>Тип</th><th>Сумма / предмет</th><th>Статус</th><th>Создана</th><th>Комментарий</th><th></th></tr></thead><tbody>${rows.map((r) => html`<tr>
    <td class="mono">#${r.id}</td><td>${r.kind === 'deposit' ? 'Пополнение' : 'Вывод предмета'}</td>
    <td>${r.item ? html`<div class="mini-it">${img(r.item.image)}<span>${r.item.name}</span></div>` : bc(r.amount)}</td><td>${finBadge(r)}</td>
    <td class="muted">${fdate(r.createdAt)}${r.decidedAt ? html`<div class="xs">решение: ${fdate(r.decidedAt)}</div>` : ''}</td><td class="sm">${r.comment || ''}</td>
    <td class="r">${r.status === 'pending' ? html`<button class="btn ghost sm" data-fcancel="${r.id}">Отменить</button>` : ''}</td></tr>`)}</tbody></table></div>`;
}
function bindCancel(ctx, after) {
  on(ctx.el, 'click', '[data-fcancel]', async (e, t) => { if (!(await confirmBox('Отменить заявку?', 'Отменить заявку', true))) return; busy(t, async () => { await api(`/api/finance/${t.dataset.fcancel}/cancel`, {}); toast('Заявка отменена', 'ok'); await refreshMe(); await after(); }); });
}
const finNav = (cur) => html`<div class="tabs">${[['/balance', 'Баланс'], ['/deposit', 'Пополнение'], ['/withdraw', 'Вывод'], ['/history?tab=ledger', 'Операции']].map(([h, l]) => html`<a class="tab ${h === cur ? 'on' : ''}" href="${h}">${l}</a>`)}</div>`;

page('/balance', async (ctx) => {
  const load = async () => {
    const d = await api('/api/finance');
    if (!ctx.alive()) return;
    setBalance(d.balance);
    const sum = {}; for (const s of d.summary) sum[s.type] = s;
    const spent = d.summary.filter((s) => s.s < 0).reduce((a, s) => a + s.s, 0);
    const got = d.summary.filter((s) => s.s > 0).reduce((a, s) => a + s.s, 0);
    mount(ctx.el, html`<div class="wrap">${head('Баланс', 'Баланс счёта в рублях (₽)')}${finNav('/balance')}
      <div class="stats mt">${stat('Текущий баланс', bc(d.balance), { cls: 'hl' })}${stat('Всего получено', bc(got), { cls: 'green' })}${stat('Всего потрачено', bc(-spent), { cls: 'red' })}${stat('Заявок', num(d.requests.length))}</div>
      <div class="grid g2 mt-l">
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('card')}</span>Пополнение</h2>${d.deposit.enabled ? html`<span class="badge ok">Доступно</span>` : html`<span class="badge">Недоступно</span>`}</div>
          ${d.deposit.enabled ? html`<p class="muted">Способов оплаты: ${d.deposit.methods.length}</p><a class="btn" href="/deposit">Пополнить</a>` : notice(d.deposit.note || 'Пополнение сейчас недоступно.', 'warn')}
          <p class="muted sm mt">Средства на баланс можно получить через <a href="/bonuses">ежедневный бонус</a>, задания, промокоды, BURGER PASS и продажу предметов из инвентаря.</p></div>
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('withdraw')}</span>Вывод предметов</h2>${d.withdraw.enabled ? html`<span class="badge ok">Доступно</span>` : html`<span class="badge">Недоступно</span>`}</div>
          ${d.withdraw.enabled ? html`<p class="muted">Вывод оформляется заявкой и проверяется сотрудником.</p><a class="btn" href="/withdraw">Создать заявку</a>` : notice(d.withdraw.note || 'Вывод сейчас недоступен.', 'warn')}</div>
      </div>
      <div class="card mt-l"><div class="sec-head"><h2>Операции по типам</h2><a href="/history?tab=ledger">Вся история</a></div>
        ${d.summary.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Тип</th><th class="r">Количество</th><th class="r">Итого</th></tr></thead><tbody>${d.summary.map((s) => html`<tr data-href="/history?tab=ledger&type=${s.type}"><td>${LEDGER[s.type] || s.type}</td><td class="r">${num(s.n)}</td><td class="r">${bc(s.s, s.s >= 0 ? 'green' : 'red')}</td></tr>`)}</tbody></table></div>` : empty('Операций пока нет.')}</div>
      <div class="card mt-l"><div class="sec-head"><h2>История заявок</h2></div>${requestsTable(d.requests)}</div></div>`);
  };
  on(ctx.el, 'click', 'tr[data-href]', (e, t) => go(t.dataset.href));
  bindCancel(ctx, load);
  await load();
}, { auth: true, title: 'Баланс' });

page('/deposit', async (ctx) => {
  const load = async () => {
    const d = await api('/api/finance');
    if (!ctx.alive()) return;
    const dep = d.deposit;
    mount(ctx.el, html`<div class="wrap">${head('Пополнение баланса', 'Баланс: ' + rub(d.balance))}${finNav('/deposit')}
      <div class="split mt"><div class="card">
        ${dep.enabled ? '' : notice(html`<b>Пополнение сейчас недоступно.</b> ${dep.note || ''}`, 'warn')}
        <form class="form" data-dep>
          <label class="fld"><span>Сумма, ₽</span><input name="amount" type="number" min="1" max="1000000" step="0.01" required ${dep.enabled ? '' : raw('disabled')}></label>
          <label class="fld"><span>Способ оплаты</span><select name="method" required ${dep.enabled ? '' : raw('disabled')}>${dep.methods.length ? dep.methods.map((m) => html`<option value="${m.id}">${m.name}</option>`) : html`<option value="">Нет подключённых способов</option>`}</select></label>
          <button class="btn" ${dep.enabled ? '' : raw('disabled')}>Перейти к оплате</button>
        </form></div>
        <div class="card prose"><h3>Как это работает</h3><ul><li>Заявка создаётся со статусом «На рассмотрении».</li><li>Баланс начисляется только после подтверждения платёжным провайдером и проверки сотрудником.</li><li>О смене статуса придёт уведомление.</li><li>Неподтверждённую заявку можно отменить.</li></ul></div></div>
      <div class="card mt-l"><div class="sec-head"><h2>Мои заявки</h2></div>${requestsTable(d.requests.filter((r) => r.kind === 'deposit'))}</div></div>`);
    bindForm($('[data-dep]', ctx.el), async (f) => {
      const r = await api('/api/finance/deposit', { amount: Number(f.amount), method: f.method });
      if (r.next?.url && /^https:/.test(r.next.url)) { location.href = r.next.url; return; }
      toast('Заявка #' + r.request.id + ' создана и ожидает подтверждения', 'ok'); await load();
    });
  };
  bindCancel(ctx, load);
  await load();
}, { auth: true, title: 'Пополнение' });

page('/withdraw', async (ctx) => {
  const load = async () => {
    const d = await api('/api/finance');
    if (!ctx.alive()) return;
    const w = d.withdraw;
    let items = [];
    if (w.enabled) { const inv = await api('/api/inventory?status=owned&sort=price_desc').catch(() => ({})); items = (inv.items || inv.rows || []).filter((i) => !i.status || i.status === 'owned'); }
    const noSteam = !state.me.steamId;
    const off = !w.enabled || noSteam;
    mount(ctx.el, html`<div class="wrap">${head('Вывод предметов', 'Вывод скина на ваш аккаунт Steam')}${finNav('/withdraw')}
      <div class="split mt"><div class="card">
        ${w.enabled ? '' : notice(html`<b>Вывод сейчас недоступен.</b> ${w.note || ''}`, 'warn')}
        ${w.enabled && noSteam ? notice(html`Для вывода привяжите Steam в <a href="/settings">настройках</a>.`, 'warn') : ''}
        <form class="form" data-wd>
          <label class="fld"><span>Предмет</span><select name="invId" required ${off ? raw('disabled') : ''}>${items.length ? items.map((i) => html`<option value="${i.id}">${i.name} · ${rub(i.price)}</option>`) : html`<option value="">Нет доступных предметов</option>`}</select></label>
          <label class="fld"><span>Trade URL Steam</span><input name="tradeUrl" required maxlength="200" placeholder="Ссылка на обмен из настроек приватности Steam" ${off ? raw('disabled') : ''}></label>
          <button class="btn" ${off ? raw('disabled') : ''}>Создать заявку на вывод</button>
        </form></div>
        <div class="card prose"><h3>Как это работает</h3><ul><li>После создания заявки предмет блокируется в инвентаре со статусом «Выводится».</li><li>Сотрудник проверяет заявку и отправляет обмен через подключённого провайдера.</li><li>При отклонении или отмене предмет возвращается в инвентарь.</li></ul></div></div>
      <div class="card mt-l"><div class="sec-head"><h2>Мои заявки на вывод</h2></div>${requestsTable(d.requests.filter((r) => r.kind === 'withdraw'))}</div></div>`);
    bindForm($('[data-wd]', ctx.el), async (f) => {
      const r = await api('/api/finance/withdraw', { invId: Number(f.invId), tradeUrl: String(f.tradeUrl).trim() });
      toast('Заявка #' + r.request.id + ' на вывод создана', 'ok'); await load();
    });
  };
  bindCancel(ctx, load);
  await load();
}, { auth: true, title: 'Вывод' });

// ---------- История ----------
page('/history', async (ctx) => {
  let tab = ctx.q.get('tab') || 'bets';
  let game = ctx.q.get('game') || '';
  let type = ctx.q.get('type') || '';
  let pg = Number(ctx.q.get('page')) || 1;
  const GF = [['', 'Все'], ['case', 'Кейсы'], ['upgrade', 'Апгрейды'], ['contract', 'Контракты'], ['battle', 'Битвы'], ['games', 'Мини-игры']];
  const load = async () => {
    const body = $('[data-body]', ctx.el);
    if (body) mount(body, loader());
    let content;
    if (tab === 'ledger') {
      const d = await api('/api/ledger?page=' + pg + (type ? '&type=' + encodeURIComponent(type) : ''));
      if (!ctx.alive()) return;
      content = html`<div class="filters"><select data-type class="sm"><option value="">Все типы операций</option>${Object.entries(LEDGER).map(([k, l]) => html`<option value="${k}" ${k === type ? raw('selected') : ''}>${l}</option>`)}</select><span class="muted sm">Всего: ${num(d.total)}</span></div>
        ${d.rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Тип</th><th>Описание</th><th class="r">Сумма</th><th class="r">Баланс после</th></tr></thead><tbody>${d.rows.map((r) => html`<tr><td class="muted">${fdate(r.created_at)}</td><td>${LEDGER[r.type] || r.type}</td><td class="sm">${r.reason || ''}</td><td class="r">${bc(r.amount, r.amount >= 0 ? 'green' : 'red')}</td><td class="r muted">${bc(r.balance_after)}</td></tr>`)}</tbody></table></div>${pager(pg, d.total, 40)}` : empty('Операций не найдено.')}`;
    } else {
      const d = await api('/api/history?page=' + pg + (game ? '&game=' + game : ''));
      if (!ctx.alive()) return;
      content = html`<div class="chips">${GF.map(([k, l]) => html`<button class="chip ${k === game ? 'on' : ''}" data-game="${k}">${l}</button>`)}</div><p class="muted sm">Всего: ${num(d.total)}</p>
        ${d.bets.length ? html`${betsTable(d.bets, { fair: true })}${pager(pg, d.total, 30)}` : empty('Здесь пока пусто.', html`<a class="btn" href="/cases">К кейсам</a>`)}`;
    }
    mount($('[data-body]', ctx.el), content);
  };
  mount(ctx.el, html`<div class="wrap">${head('История', 'Открытия, игры и операции с балансом', html`<a class="btn ghost" href="/fair">Проверить честность</a>`)}<div data-tabs></div><div data-body class="mt"></div></div>`);
  const drawTabs = () => mount($('[data-tabs]', ctx.el), tabs([['bets', 'Игры и открытия'], ['ledger', 'Операции с балансом']], tab));
  drawTabs();
  const sync = () => setQuery({ tab: tab === 'bets' ? '' : tab, game: tab === 'bets' ? game : '', type: tab === 'ledger' ? type : '', page: pg > 1 ? pg : '' });
  on(ctx.el, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; pg = 1; sync(); drawTabs(); load().catch(() => {}); });
  on(ctx.el, 'click', '[data-game]', (e, t) => { game = t.dataset.game; pg = 1; sync(); load().catch(() => {}); });
  on(ctx.el, 'change', '[data-type]', (e, t) => { type = t.value; pg = 1; sync(); load().catch(() => {}); });
  on(ctx.el, 'click', '[data-page]', (e, t) => { pg = Number(t.dataset.page) || 1; sync(); load().catch(() => {}); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  await load();
}, { auth: true, title: 'История' });

export { ago, avatar, userLink, itemCard, safeUrl, toCents, GAMES, modal, uploadImage, copy, NEWS_KIND, newsCard, fday };
