// BURGER SKIN — публичная страница дропа /drop/:token (кнопка «Поделиться дропом»).
// Данные берутся из записанной ставки: игрок не может «нарисовать» себе чужой или фальшивый дроп.
import { page, api, html, mount, on, busy, rub, img, fdate, WEARS, splitName, rarityRu, cssColor, userLink, state } from '../core.js';
import { icon } from '../icons.js';
import { cineOn, shareOn, loadCine } from '../cine-mode.js';

const PAL = {
  godlike: ['255,182,39', '255,226,150'], mythic: ['150,80,255', '214,150,255'], divine: ['255,232,176', '200,230,255'],
  knife: ['205,222,245', '255,255,255'], glove: ['122,199,79', '244,162,89'],
};

page('/drop/:token', async (ctx) => {
  const { drop: d } = await api('/api/drops/' + encodeURIComponent(ctx.params.token));
  const it = d.item; const fx = d.fx; const [w, p] = splitName(it.name);
  const pal = PAL[fx?.scene] || PAL.godlike;
  document.title = (fx?.label || 'Дроп') + ': ' + it.name + ' — ' + (state.site?.site?.name || 'BURGER SKIN');
  const caseLink = d.case?.slug ? html`<a href="/cases/${d.case.slug}">${d.case.name}</a>` : html`<span>${d.case?.name || 'Кейс'}</span>`;
  mount(ctx.el, html`<div class="wrap">
    <section class="drop-hero" style="--ca:rgb(${pal[0]});--cb:rgb(${pal[1]})">
      <div class="dh-img">${img(it.image, '', it.name)}</div>
      <div>
        ${fx ? html`<span class="drop-fx-badge ${fx.scene}">${icon('trophy')} ${fx.label}</span>` : ''}
        <h1 class="dh-label" style="margin-top:10px">${fx?.label || 'Дроп'}</h1>
        <div class="muted">${p ? w : ''}</div>
        <h2 style="margin:2px 0 10px">${p || w}</h2>
        <div class="chips mb">
          <span class="badge" style="color:${cssColor(it.color)}">${rarityRu(it.rarityName)}</span>
          ${it.wear ? html`<span class="badge">${WEARS[it.wear] || it.wear} (${it.wear})</span>` : ''}
          ${it.float != null ? html`<span class="badge mono">float ${Number(it.float).toFixed(6)}</span>` : ''}
          ${it.stattrak ? html`<span class="tag st">StatTrak™</span>` : ''}${it.souvenir ? html`<span class="tag sv">Сувенир</span>` : ''}
        </div>
        <div class="xs dim">СТОИМОСТЬ НА МОМЕНТ ДРОПА</div>
        <div class="dh-price">${rub(it.price)}</div>
        ${it.priceNow && it.priceNow !== it.price ? html`<div class="muted sm">Сейчас оценивается в ${rub(it.priceNow)}</div>` : ''}
        <p class="muted sm">Выбил ${userLink(d.user)} · ${caseLink} · ${fdate(d.at)}</p>
        <div class="row gap wrap mt">
          ${fx && cineOn() ? html`<button class="btn" data-replay>${icon('play')} Смотреть сцену</button>` : ''}
          ${shareOn() ? html`<button class="btn ghost" data-share>${icon('link')} Поделиться дропом</button>` : ''}
          ${d.case?.slug ? html`<a class="btn ghost" href="/cases/${d.case.slug}">${icon('cases')} Открыть этот кейс</a>` : ''}
        </div>
        <p class="xs dim mt mb0">Provably Fair: хеш сервера <span class="mono">${d.fair?.serverHash || '—'}</span> · nonce ${d.fair?.nonce ?? '—'}. <a href="/fair">Как проверить</a></p>
      </div>
    </section></div>`);
  on(ctx.el, 'click', '[data-replay]', (e, b) => busy(b, async () => {
    const m = await loadCine();
    m.playDrop({ item: it, fx, share: d.token, replay: true, caseName: d.case?.name });
  }));
  on(ctx.el, 'click', '[data-share]', (e, b) => busy(b, async () => {
    const m = await loadCine();
    await m.openShare({ item: it, fx, share: d.token });
  }));
  // Впервые открытая ссылка сразу показывает сцену (если игрок не выключил кинодропы).
  if (fx && cineOn() && ctx.q.get('play') === '1') loadCine().then((m) => m.playDrop({ item: it, fx, share: d.token, caseName: d.case?.name })).catch(() => {});
}, { title: 'Дроп' });
