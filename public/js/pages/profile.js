// BURGER SKIN — друзья, профили, уведомления, настройки аккаунта.
import { state, html, raw, mount, $, api, num, bc, fdate, fday, ago, ROLES, itemCard, avatar, userLink, empty, loader, head, tabs, notice, toast, modal, confirmBox, busy, bindForm, page, go, on, setQuery, refreshMe, renderHeader, safeUrl } from '../core.js';
import { icon } from '../icons.js';
import { stat, uploadImage, betsTable } from './shared.js';

// ---------- Приглашение друга в битву ----------
export async function inviteToBattle(user) {
  const d = await api('/api/battles');
  const mine = (d.mine || []).filter((b) => b.status === 'waiting' && b.creatorId === state.me?.id);
  const m = modal(html`<h3>Позвать ${user.nickname} в Case Battle</h3>
    ${mine.length ? html`<div class="stack">${mine.map((b) => html`<div class="friend"><div class="grow"><b>Битва #${b.id}</b><div class="muted sm">${b.cases?.length || 0} раунд(ов) · вход ${bc(b.cost)} · ${b.players?.length || 0}/${b.maxPlayers} игроков</div></div><button class="btn sm" data-binv="${b.id}">Пригласить</button></div>`)}</div>`
      : html`<p class="muted">У вас нет ожидающих битв. Создайте комнату — и пригласите друга прямо из неё.</p><div class="row end gap"><a class="btn" href="/battles/new" data-close>Создать битву</a></div>`}`);
  on(m.el, 'click', '[data-binv]', (e, btn) => busy(btn, async () => { await api(`/api/battles/${btn.dataset.binv}/invite`, { userId: user.id }); btn.textContent = 'Приглашение отправлено'; btn.disabled = true; toast('Приглашение отправлено', 'ok'); }));
}

function friendActions(u, st) {
  if (!state.me || u.id === state.me.id) return '';
  if (st === 'friends') return html`<button class="btn sm" data-battle="${u.id}" data-nick="${u.nickname}">В битву</button><button class="btn ghost sm" data-fremove="${u.id}">Удалить</button>`;
  if (st === 'incoming') return html`<button class="btn sm" data-faccept="${u.id}">Принять</button><button class="btn ghost sm" data-fremove="${u.id}">Отклонить</button>`;
  if (st === 'outgoing') return html`<span class="badge">Заявка отправлена</span><button class="btn ghost sm" data-fremove="${u.id}">Отменить</button>`;
  return html`<button class="btn sm" data-fadd="${u.id}">Добавить в друзья</button>`;
}
function bindFriendActions(root, after) {
  on(root, 'click', '[data-fadd]', (e, t) => busy(t, async () => { const r = await api(`/api/friends/${t.dataset.fadd}/request`, {}); toast(r.status === 'friends' ? 'Теперь вы друзья' : 'Заявка отправлена', 'ok'); await after(); }));
  on(root, 'click', '[data-faccept]', (e, t) => busy(t, async () => { await api(`/api/friends/${t.dataset.faccept}/accept`, {}); toast('Заявка принята', 'ok'); await after(); }));
  on(root, 'click', '[data-fremove]', async (e, t) => { if (!(await confirmBox('Удалить игрока из списка друзей или отменить заявку?', 'Да', true))) return; busy(t, async () => { await api(`/api/friends/${t.dataset.fremove}/remove`, {}); await after(); }); });
  on(root, 'click', '[data-battle]', (e, t) => busy(t, () => inviteToBattle({ id: Number(t.dataset.battle), nickname: t.dataset.nick })));
}
const friendRow = (u, st) => html`<div class="friend">${avatar(u)}<div class="grow"><a href="/u/${u.id}"><b>${u.nickname}</b></a><div class="muted sm">${ROLES[u.role] && u.role !== 'USER' ? ROLES[u.role] + ' · ' : ''}${u.since ? 'с ' + fday(u.since) : u.createdAt ? 'на сайте с ' + fday(u.createdAt) : ''}</div></div><div class="row gap" style="flex-wrap:wrap;justify-content:flex-end">${friendActions(u, st)}</div></div>`;

// ---------- Друзья ----------
page('/friends', async (ctx) => {
  let tab = ctx.q.get('tab') || 'friends';
  let found = null; let query = '';
  const load = async () => {
    const d = await api('/api/friends');
    if (!ctx.alive()) return;
    const lists = { friends: [d.friends, 'friends', 'У вас пока нет друзей. Найдите игроков через поиск выше.'], incoming: [d.incoming, 'incoming', 'Новых заявок нет.'], outgoing: [d.outgoing, 'outgoing', 'Исходящих заявок нет.'] };
    const [list, st, emptyText] = lists[tab] || lists.friends;
    mount(ctx.el, html`<div class="wrap narrow">${head('Друзья', 'Играйте вместе и приглашайте друзей в Case Battle')}
      <form class="inline-form card" data-search><label class="fld"><span>Поиск игроков</span><input name="q" minlength="2" maxlength="40" required value="${query}" placeholder="Никнейм или логин"></label><button class="btn">Найти</button></form>
      ${found ? html`<div class="card mt"><div class="sec-head"><h2>Результаты поиска</h2><button class="btn ghost sm" data-clear>Скрыть</button></div><div class="stack">${found.length ? found.map((u) => friendRow(u, u.friend)) : empty('Никого не нашлось.')}</div></div>` : ''}
      <div class="mt-l">${tabs([['friends', `Друзья (${d.friends.length})`], ['incoming', `Входящие (${d.incoming.length})`], ['outgoing', `Исходящие (${d.outgoing.length})`]], tab)}</div>
      <div class="stack mt">${list.length ? list.map((u) => friendRow(u, st)) : empty(emptyText)}</div></div>`);
    bindForm($('[data-search]', ctx.el), async (f) => { query = String(f.q || '').trim(); const r = await api('/api/users/search?q=' + encodeURIComponent(query)); found = r.users.filter((u) => u.id !== state.me.id); await load(); });
  };
  on(ctx.el, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; setQuery({ tab: tab === 'friends' ? '' : tab }); load().catch(() => {}); });
  on(ctx.el, 'click', '[data-clear]', () => { found = null; query = ''; load().catch(() => {}); });
  bindFriendActions(ctx.el, async () => { if (found && query) { const r = await api('/api/users/search?q=' + encodeURIComponent(query)); found = r.users.filter((u) => u.id !== state.me.id); } await load(); });
  await load();
}, { auth: true, title: 'Друзья' });

// ---------- Профиль ----------
async function profileView(ctx, id) {
  const own = state.me && Number(id) === state.me.id;
  let tab = ctx.q.get('tab') || 'recent';
  const load = async () => {
    const d = await api('/api/users/' + encodeURIComponent(id));
    if (!ctx.alive()) return;
    const u = d.user; const s = d.stats;
    const T = [['recent', 'Последние дропы'], ['best', 'Лучшие предметы']];
    if (own) T.push(['games', 'История игр']);
    mount(ctx.el, html`<div class="wrap">
      <div class="prof">${avatar(u, 'xl')}
        <div><h1>${u.nickname}</h1>
          <div class="row gap" style="flex-wrap:wrap">${u.role !== 'USER' ? html`<span class="badge warn">${ROLES[u.role] || u.role}</span>` : ''}${u.steamName ? html`<span class="badge info">Steam: ${u.steamName}</span>` : ''}${u.privateProfile ? html`<span class="badge">Закрытый профиль</span>` : ''}</div>
          <p class="muted sm mt">На BURGER SKIN с ${fday(u.createdAt)}${u.lastSeen ? ' · был(а) в сети ' + ago(u.lastSeen) : ''} · друзей: ${num(d.friends)}</p></div>
        <div class="row gap" style="flex-wrap:wrap">${own ? html`<a class="btn ghost" href="/settings">Настройки</a><a class="btn ghost" href="/inventory">Инвентарь</a><a class="btn ghost" href="/history">История</a><a class="btn" href="/balance">Баланс ${bc(state.me.balance)}</a>` : state.me ? friendActions(u, d.friend) : html`<a class="btn" href="/login?next=/u/${u.id}">Войти, чтобы добавить</a>`}</div>
      </div>
      ${d.hidden ? notice('Игрок скрыл свои предметы и историю. Доступна только общая статистика.') : ''}
      <div class="stats mt-l">
        ${stat('Место в рейтинге', '#' + num(s.rank), { cls: 'hl' })}${stat('Открыто кейсов', num(s.opens))}${stat('Оборот', num(s.wagered) + ' ₽')}
        ${stat('Лучший дроп', bc(s.bestDrop))}${stat('Игр сыграно', num(s.games))}${stat('Битвы', num(s.battles), { sub: 'побед: ' + num(s.battlesWon) })}
        ${stat('Апгрейды', num(s.upgrades), { sub: 'успешных: ' + num(s.upgradesWon) })}${stat('Контракты', num(s.contracts))}${stat('BURGER PASS', 'Ур. ' + num(s.passLevel))}${stat('Достижения', num(s.achievements))}
      </div>
      <div class="mt-l">${tabs(T, tab)}</div><div data-body class="mt"></div></div>`);
    const body = $('[data-body]', ctx.el);
    if (tab === 'games' && own) {
      mount(body, loader());
      const h = await api('/api/history');
      if (!ctx.alive()) return;
      mount(body, h.bets.length ? html`${betsTable(h.bets)}<div class="row end mt"><a class="btn ghost" href="/history">Вся история</a></div>` : empty('Вы ещё не играли.', html`<a class="btn" href="/cases">Открыть кейс</a>`));
    } else {
      const list = tab === 'best' ? d.best : d.recent;
      mount(body, list.length ? html`<div class="grid g-items">${list.map((it) => itemCard(it, { href: '/skins/' + (it.itemId || it.item_id || it.id) }))}</div>` : empty(d.hidden ? 'Предметы скрыты игроком.' : 'Здесь пока пусто.'));
    }
  };
  on(ctx.el, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; setQuery({ tab: tab === 'recent' ? '' : tab }); load().catch(() => {}); });
  bindFriendActions(ctx.el, load);
  await load();
}
page('/profile', (ctx) => profileView(ctx, state.me.id), { auth: true, title: 'Профиль' });
page('/u/:id', (ctx) => profileView(ctx, ctx.params.id), { title: 'Профиль игрока' });

// ---------- Уведомления ----------
const NOTIF_ICON = { friend: 'friends', battle: 'battles', support: 'support', pass: 'pass', achievement: 'medal', event: 'trophy', finance: 'card', bonus: 'bonuses', referral: 'invite', system: 'megaphone', game: 'games' };
page('/notifications', async (ctx) => {
  const load = async () => {
    const d = await api('/api/notifications');
    if (!ctx.alive()) return;
    if (state.me) { state.me.unread = d.unread; renderHeader(); }
    mount(ctx.el, html`<div class="wrap narrow">${head('Уведомления', d.unread ? `Непрочитанных: ${d.unread}` : 'Все уведомления прочитаны', d.unread ? html`<button class="btn ghost" data-readall>Прочитать все</button>` : '')}
      <div class="stack">${d.rows.length ? d.rows.map((n) => html`<div class="friend" ${n.read ? '' : raw('style="border-color:rgba(255,182,39,.45)"')} ${n.link && String(n.link).startsWith('/') ? raw(`data-nlink="${n.id}" data-href="${String(n.link).replace(/"/g, '')}" role="button" tabindex="0" style="cursor:pointer${n.read ? '' : ';border-color:rgba(255,182,39,.45)'}"`) : ''}>
        <span class="n-ico">${icon(NOTIF_ICON[n.type] || 'bell')}</span><div class="grow"><b>${n.title}</b>${n.body ? html`<div class="muted sm">${n.body}</div>` : ''}<div class="muted xs">${fdate(n.created_at)}</div></div>${n.read ? '' : html`<span class="badge warn">Новое</span>`}</div>`) : empty('Уведомлений пока нет.')}</div></div>`);
  };
  on(ctx.el, 'click', '[data-readall]', (e, t) => busy(t, async () => { await api('/api/notifications/read', {}); await load(); }));
  on(ctx.el, 'click', '[data-nlink]', async (e, t) => { try { await api('/api/notifications/read', { ids: [Number(t.dataset.nlink)] }); } catch { } go(t.dataset.href); });
  await load();
}, { auth: true, title: 'Уведомления' });

// ---------- Настройки ----------
const uaShort = (ua) => { const s = String(ua || ''); const b = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Браузер'; const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : ''; return b + (os ? ' · ' + os : ''); };
page('/settings', async (ctx) => {
  let avatarUrl = state.me.avatar || '';
  const opts = await api('/api/auth/options').catch(() => ({}));
  const load = async () => {
    const [me, ss] = await Promise.all([refreshMe(), api('/api/me/sessions')]);
    if (!ctx.alive() || !me) return;
    const okMsg = ctx.q.get('ok') === 'steam' ? notice('Steam успешно привязан к аккаунту.', 'ok') : '';
    const errMsg = ctx.q.get('error') ? notice(ctx.q.get('error'), 'err') : '';
    mount(ctx.el, html`<div class="wrap">${head('Настройки аккаунта', 'Логин: ' + me.login + ' · аккаунт создан ' + fday(me.createdAt), html`<a class="btn ghost" href="/profile">Мой профиль</a>`)}${okMsg}${errMsg}
      <div class="grid g2">
        <div class="card"><div class="sec-head"><h2>Профиль</h2></div>
          <form class="form" data-profile>
            <div class="row gap" style="align-items:center"><span data-ava>${avatar({ nickname: me.nickname, avatar: avatarUrl }, 'xl')}</span>
              <div class="stack-l"><label class="btn ghost sm" style="cursor:pointer">Загрузить аватар<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file hidden></label>${avatarUrl ? html`<button type="button" class="btn ghost sm" data-noava>Убрать</button>` : ''}<small class="muted">PNG, JPG, WEBP или GIF до 2 МБ</small></div></div>
            <label class="fld"><span>Никнейм</span><input name="nickname" required minlength="2" maxlength="24" value="${me.nickname}"></label>
            <label class="fld"><span>Email</span><input name="email" type="email" maxlength="120" value="${me.email || ''}" placeholder="для восстановления доступа"></label>
            <label class="check"><input type="checkbox" name="privateProfile" ${me.privateProfile ? raw('checked') : ''}><span>Скрыть мои предметы и историю от других игроков</span></label>
            <label class="check"><input type="checkbox" name="notifyEmail" ${me.notifyEmail ? raw('checked') : ''}><span>Получать важные уведомления на email</span></label>
            <div class="row end"><button class="btn">Сохранить</button></div>
          </form></div>
        <div class="card"><div class="sec-head"><h2>${me.hasPassword ? 'Смена пароля' : 'Задать пароль'}</h2></div>
          <form class="form" data-password>
            ${me.hasPassword ? html`<label class="fld"><span>Текущий пароль</span><input name="oldPassword" type="password" required autocomplete="current-password"></label>` : html`<p class="muted sm">Вы входите через Steam. Задайте пароль, чтобы входить по логину.</p>`}
            <label class="fld"><span>Новый пароль</span><input name="newPassword" type="password" required minlength="8" maxlength="128" autocomplete="new-password"><small class="muted">Не менее 8 символов, буквы и цифры</small></label>
            <label class="fld"><span>Повторите пароль</span><input name="repeat" type="password" required autocomplete="new-password"></label>
            <div class="row end"><button class="btn">Сохранить пароль</button></div>
          </form></div>
        <div class="card"><div class="sec-head"><h2>Steam</h2></div>
          ${me.steamId ? html`<p>Привязан аккаунт <b>${me.steamName || me.steamId}</b></p><p class="muted sm mono">SteamID: ${me.steamId}</p><button class="btn ghost" data-unlink>Отвязать Steam</button>`
            : opts.steam ? html`<p class="muted">Привяжите Steam, чтобы входить в один клик. Привязка также понадобится для вывода предметов, когда он станет доступен.</p><a class="btn steam" href="/api/auth/steam?mode=link" data-external>Привязать Steam</a>`
            : notice('Вход через Steam сейчас отключён администрацией.', 'warn')}
        </div>
        <div class="card"><div class="sec-head"><h2>Честность игр</h2></div><p class="muted">Управляйте своим client seed и проверяйте любой результат на странице Provably Fair.</p><div class="kv"><span>Хеш сида сервера</span><span class="mono xs">${me.fair?.serverHash || '—'}</span><span>Client seed</span><span class="mono">${me.fair?.clientSeed || '—'}</span><span>Nonce</span><span>${me.fair?.nonce ?? 0}</span></div><div class="row end mt"><a class="btn ghost" href="/fair">Provably Fair</a></div></div>
      </div>
      <div class="card mt-l"><div class="sec-head"><h2>Активные сеансы</h2><button class="btn ghost sm" data-logoutall>Выйти на всех устройствах</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Устройство</th><th>IP</th><th>Вход</th><th class="r">Активность</th></tr></thead><tbody>${ss.sessions.map((s) => html`<tr><td>${uaShort(s.ua)} ${s.current ? html`<span class="badge ok">Это устройство</span>` : ''}</td><td class="mono">${s.ip || '—'}</td><td class="muted">${fdate(s.createdAt)}</td><td class="r muted">${s.lastSeen ? ago(s.lastSeen) : '—'}</td></tr>`)}</tbody></table></div>
      </div></div>`);
    bindForm($('[data-profile]', ctx.el), async (f) => {
      const r = await api('/api/me/profile', { nickname: f.nickname, email: f.email || '', avatar: avatarUrl || null, privateProfile: !!f.privateProfile, notifyEmail: !!f.notifyEmail });
      state.me = r.user; renderHeader(); toast('Профиль сохранён', 'ok');
    });
    bindForm($('[data-password]', ctx.el), async (f, form) => {
      if (f.newPassword !== f.repeat) throw new Error('Пароли не совпадают');
      await api('/api/me/password', { oldPassword: f.oldPassword || '', newPassword: f.newPassword });
      form.reset(); toast('Пароль сохранён. Остальные сеансы завершены.', 'ok'); await load();
    });
  };
  on(ctx.el, 'change', '[data-file]', async (e, t) => {
    const file = t.files?.[0]; if (!file) return;
    try { const r = await uploadImage(file, 'avatar'); avatarUrl = r.url; mount($('[data-ava]', ctx.el), avatar({ nickname: state.me.nickname, avatar: safeUrl(avatarUrl) }, 'xl')); toast('Аватар загружен — нажмите «Сохранить»', 'info'); } catch (err) { toast(err.message || 'Не удалось загрузить файл', 'err'); }
    t.value = '';
  });
  on(ctx.el, 'click', '[data-noava]', () => { avatarUrl = ''; mount($('[data-ava]', ctx.el), avatar({ nickname: state.me.nickname }, 'xl')); toast('Аватар будет удалён после сохранения', 'info'); });
  on(ctx.el, 'click', '[data-unlink]', async (e, t) => { if (!(await confirmBox('Отвязать Steam от аккаунта?', 'Отвязать', true))) return; busy(t, async () => { await api('/api/me/steam/unlink', {}); toast('Steam отвязан', 'ok'); await load(); }); });
  on(ctx.el, 'click', '[data-logoutall]', async (e, t) => { if (!(await confirmBox('Завершить все сеансы, включая текущий?', 'Выйти везде', true))) return; busy(t, async () => { await api('/api/auth/logout-all', {}); state.me = null; renderHeader(); go('/login'); }); });
  on(ctx.el, 'click', '[data-external]', (e, t) => { e.preventDefault(); e.stopPropagation(); location.href = t.getAttribute('href'); });
  await load();
}, { auth: true, title: 'Настройки' });
