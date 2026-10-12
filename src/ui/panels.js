// The four side panels (250x422 at (550,30)), docs/presentation.md §2.4.
import { Widget, Button, TextField, ListBox, CURVE_COLORS } from '../engine/ui.js';
import { BOOK } from '../sim/company.js';
import { RECENTER } from '../world/world.js';

const A = 'Fonte_Tahoma_violet_13x17_FAR';
const B = 'Fonte_Tahoma_violetfonce_13x17_FAR';
const C = 'Fonte_Tahoma_violetfonce_13x17_FAB';
const fmt = (v) => Math.round(v).toLocaleString('en-US');

// +/- buttons with auto-repeat while held (callback 0x418779).
export function repeatButton(x, y, sprite, onStep, opts = {}) {
  const b = new Button(x, y, sprite, { w: 14, h: 14, sound: null, ...opts });
  b.onClick = null;
  let held = 0;
  const base = b.onEvent.bind(b);
  b.onEvent = (ev) => {
    if (ev.type === 'down' && ev.button === 0 && b.enabled && b.contains(ev.x, ev.y)) { onStep(); b.game?.ui.clicked(b); held = -0.35; }
    return base(ev);
  };
  const upd = b.onUpdate.bind(b);
  b.onUpdate = (dt, input) => {
    upd(dt, input);
    if (b.pressed && input.down) { held += dt; while (held > 0.06) { held -= 0.06; onStep(); } }
  };
  // A little padding around the 14x14 sprite, but not so much that neighbouring +/- buttons overlap.
  b.contains = (px, py) => px >= b.ax - 1 && py >= b.ay - 3 && px < b.ax + 14 && py < b.ay + 17;
  return b;
}

export function buildIndicatorPanel(p, hud) {
  const co = () => hud.player;
  const S = () => hud.sim.data.setup;
  const t = (id) => hud.t(id);
  const row = (y, font, label, value) => {
    p.add(new TextField(20, y, 145, 14, typeof label === 'function' ? label : () => t(label), { font }));
    if (value) p.add(new TextField(120, y, 110, 14, value, { font, align: 'right' }));
  };
  row(35, A, 'PANNEL_INDICATORS_SOLDE', () => fmt(co().bottomLine));
  row(49, B, 'PANNEL_INDICATORS_DEBTS', () => fmt(co().debt));
  row(61, B, 'PANNEL_INDICATORS_FALLING_DUE', () => (co().debtDays ? `${co().debtDays} d` : '-'));
  row(75, A, 'PANNEL_INDICATORS_ACTION_PRICE', () => fmt(co().sharePrice));
  row(89, B, 'PANNEL_INDICATORS_PRODUCTION', () => `${co().target}`);
  row(101, B, 'PANNEL_INDICATORS_PRODUCTS_SOLD', () => fmt(co().soldTotal));
  row(113, B, 'PANNEL_INDICATORS_STOCKS', () => fmt(co().stock));
  // Price block: components, your margin (adjustable), distributor margin, retail price.
  p.add(new TextField(20, 127, 145, 14, () => t('PANNEL_INDICATORS_PRIX_COMPOSANTS'), { font: A }));
  p.add(new TextField(160, 127, 55, 14, () => fmt(co().unitCost), { font: A, align: 'right' }));
  p.add(new TextField(20, 139, 145, 14, () => t('PANNEL_INDICATORS_MARGE_JOUEUR'), { font: A }));
  p.add(new TextField(160, 139, 50, 14, () => fmt(co().price - co().unitCost), { font: A, align: 'right' }));
  p.add(new TextField(20, 151, 145, 14, () => t('PANNEL_INDICATORS_MARGE_DISTRIBUTEUR'), { font: A }));
  p.add(new TextField(160, 151, 55, 14, () => fmt(co().distributorPrice - co().price), { font: A, align: 'right' }));
  p.add(new TextField(20, 163, 145, 14, () => t('PANNEL_INDICATORS_PRIX_VENTE'), { font: A }));
  p.add(new TextField(160, 163, 55, 14, () => fmt(co().retailPrice), { font: A, align: 'right' }));
  const setPrice = (d) => {
    const c = co();
    c.price = Math.max(c.unitCost, Math.min(S().MAX_PRICE, c.price + d * S().PRODUCT_PRICE_INCREMENT));
  };
  p.add(repeatButton(214, 141, 'Button_More_Light', () => setPrice(1), { tooltip: 'PANNEL_INDICATORS_MARGE_JOUEUR' }));
  p.add(repeatButton(228, 141, 'Button_Less_Light', () => setPrice(-1), { tooltip: 'PANNEL_INDICATORS_MARGE_JOUEUR' }));
  row(177, B, 'PANNEL_INDICATORS_FISCAL_RISK', () => `${co().fiscalRisk}%`);
  row(191, A, 'PANNEL_INDICATORS_SECURITY_PRODUCTION', () => `${co().security('PROD')}`);
  row(203, A, 'PANNEL_INDICATORS_SECURITY_LABORATORY', () => `${co().security('LABO')}`);
  row(215, A, 'PANNEL_INDICATORS_SECURITY_MARKETING', () => `${co().security('MARKETING')}`);
  row(227, A, 'PANNEL_INDICATORS_SECURITY_ADMINISTRATION', () => `${co().security('ADMIN')}`);
  row(241, B, () => `${t('PANNEL_INDICATORS_PUBLIC_NOTORIETY')} ${co().notoriety}   ${t('PANNEL_INDICATORS_PRODUCT_IMAGE')} ${co().image}`);
  p.add(new TextField(20, 253, 210, 14, () => t('PANNEL_INDICATORS_PUB'), { font: A }));
  // Monthly advertising budgets: specialist press (technoids, left) and TV (emotives, right).
  const step = () => S().PUB_BUDGET_INCREMENT;
  p.add(new TextField(20, 268, 64, 14, () => fmt(co().pressMonthly), { font: A, align: 'right', tooltip: 'LB_ACTION_PUB_TEXT1' }));
  p.add(new TextField(132, 268, 64, 14, () => fmt(co().tvMonthly), { font: A, align: 'right', tooltip: 'LB_ACTION_PUB_TEXT2' }));
  const bud = (k, d) => () => { const c = co(); c[k] = Math.max(0, Math.min(S().MAX_PUB_BUDGET, c[k] + d * step())); };
  p.add(repeatButton(86, 270, 'Button_More_Light', bud('pressMonthly', 1)));
  p.add(repeatButton(100, 270, 'Button_Less_Light', bud('pressMonthly', -1)));
  p.add(repeatButton(198, 270, 'Button_More_Light', bud('tvMonthly', 1)));
  p.add(repeatButton(212, 270, 'Button_Less_Light', bud('tvMonthly', -1)));
  p.add(new TextField(23, 307, 210, 14, () => t('PANNEL_INDICATORS_MARKET'), { font: B }));
  // Market share bars (technoids top, emotives bottom), one colour per company.
  const bars = p.add(new Widget(30, 322, 200, 80));
  bars.onDraw = (r) => {
    const sim = hud.sim;
    const res = sim.market.last?.results ?? [];
    const draw = (y, key, note) => {
      r.rect(bars.ax, bars.ay + y, 200, 9, 'rgb(127,127,127)');
      const total = res.reduce((a, x) => a + x[key], 0) || 1;
      let x = 0;
      for (const rr of res) {
        const w = Math.round((rr[key] / total) * 200);
        if (!w) continue;
        const [cr, cg, cb] = CURVE_COLORS[rr.id % 8];
        r.rect(bars.ax + x, bars.ay + y, w, 9, `rgb(${cr},${cg},${cb})`);
        x += w;
      }
      r.text(A, `${t('PANNEL_INDICATORS_PRODUCT_NOTE')} ${co()[note]}%`, bars.ax + 12, bars.ay + y + 26);
    };
    draw(15, 'soldT', 'noteT');
    draw(61, 'soldE', 'noteE');
  };
  bars.tooltip = 'PANNEL_INDICATORS_MARKET';
}

export function buildCreditDebitPanel(p, hud) {
  const co = () => hud.player;
  const t = (id) => hud.t(id);
  const row = (y, font, id, cat) => {
    p.add(new TextField(20, y, 140, 13, () => t(id), { font }));
    if (cat !== undefined) {
      const v = typeof cat === 'function' ? cat : () => co().ledgerMonth[cat];
      p.add(new TextField(155, y, 85, 13, () => fmt(v()), { font: A, align: 'right' }));
    }
  };
  row(34, A, 'PANNEL_DEBIT_EMPLOYES');
  row(47, B, 'PANNEL_DEBIT_SALARY', BOOK.SALARIES);
  row(60, B, 'PANNEL_DEBIT_INDEMNITIES', BOOK.SEVERANCE);
  row(73, B, 'PANNEL_DEBIT_ACTIONS', BOOK.ACTIONS);
  row(86, A, 'PANNEL_DEBIT_ACHATS');
  row(99, B, 'PANNEL_DEBIT_WORKSTATION', BOOK.WORKSTATIONS);
  row(112, B, 'PANNEL_DEBIT_EQUIP', BOOK.OBJECTS);
  row(125, B, 'PANNEL_DEBIT_COMPOSANTS', BOOK.COMPONENTS);
  row(138, A, 'PANNEL_DEBIT_PUB');
  row(151, B, 'PANNEL_DEBIT_PUB_TV', BOOK.TV);
  row(164, B, 'PANNEL_DEBIT_PRESSE', BOOK.PRESS);
  row(177, A, 'PANNEL_DEBIT_DIVERS');
  row(190, B, 'PANNEL_DEBIT_REMBOURSEMENT', BOOK.LOAN_REPAY);
  row(203, B, 'PANNEL_DEBIT_AMENDES', BOOK.FINES);
  row(242, A, 'PANNEL_DEBIT_TOTAL', () => co().totalDebits());
  p.add(new TextField(0, 270, 250, 22, () => t('PANNEL_CREDIT'), { font: 'Fonte_NovaBlackExpandedSSi_Gray_19x16xVAAR', align: 'center' }));
  row(293, B, 'PANNEL_CREDIT_VENTE', () => co().ledgerMonth[BOOK.SALES] + co().ledgerMonth[BOOK.AWARDS]);
  row(306, B, 'PANNEL_CREDIT_PROCES', BOOK.TRIALS);
  row(319, B, 'PANNEL_CREDIT_BREVETS', BOOK.PATENTS);
  row(332, B, 'PANNEL_CREDIT_PRET', BOOK.LOAN);
  row(384, A, 'PANNEL_CREDIT_TOTAL', () => co().totalCredits());
}

export function buildFinancingPanel(p, hud) {
  const co = () => hud.player;
  const t = (id) => hud.t(id);
  const state = { amount: 100000, offers: [] };
  const refresh = () => { state.offers = co().loanOffers(state.amount); list.setItems(state.offers); };
  p.add(new TextField(15, 30, 230, 15, () => t('PANNEL_FINANCING_SUGGEST_SUM'), { font: A }));
  p.add(new TextField(75, 45, 120, 20, () => fmt(state.amount), { font: A, align: 'right' }));
  const change = (d) => {
    const steps = [5000, 10000, 20000, 50000, 100000, 200000, 300000, 400000, 500000, 600000, 800000, 1000000, 2000000, 5000000, 10000000];
    let i = steps.findIndex((s) => s >= state.amount);
    if (i < 0) i = steps.length - 1;
    state.amount = steps[Math.max(0, Math.min(steps.length - 1, i + d))];
    refresh();
  };
  p.add(repeatButton(200, 48, 'Button_More_Light', () => change(1)));
  p.add(repeatButton(214, 48, 'Button_Less_Light', () => change(-1)));
  p.add(new TextField(15, 81, 109, 11, () => t('PANNEL_FINANCING_FINANCIAL'), { font: C, align: 'center' }));
  p.add(new TextField(124, 81, 52, 11, () => t('PANNEL_FINANCING_RATE'), { font: C, align: 'center' }));
  p.add(new TextField(176, 81, 56, 11, () => t('PANNEL_FINANCING_DURATION'), { font: C, align: 'center' }));
  const list = p.add(new ListBox(15, 92, 233, 280, {
    rowHeight: 23,
    renderRow: (r, o, x, y, w, sel, hover) => {
      if (sel || hover) r.rect(x, y + 2, w, 20, sel ? 'rgba(90,60,160,0.35)' : 'rgba(90,60,160,0.15)');
      r.text(A, o.name, x + 3, y + 16);
      r.text(A, `${o.rate}%`, x + 109 + 26, y + 16, { align: 'center' });
      r.text(A, `${o.days} d`, x + 161 + 28, y + 16, { align: 'center' });
    },
  }));
  const borrow = p.add(new Button(78, 388, 'Button_Loan', { w: 99, h: 29, label: () => t('PANNEL_FINANCING_LOAN'), font: A, hoverFont: B,
    onClick: () => {
      const o = state.offers[list.selected];
      if (!o) return;
      co().takeLoan(o);
      list.selected = -1;
      refresh();
    } }));
  borrow.onUpdate = function (dt, input) { Button.prototype.onUpdate.call(this, dt, input); this.enabled = list.selected >= 0; };
  p.onShow = refresh;
  refresh();
}

export function buildNewsPanel(p, hud) {
  const co = () => hud.player;
  const t = (id) => hud.t(id);
  const filter = { home: true, letter: true };
  const home = p.add(new Button(22, 17, 'Button_News_Home', { toggle: true, checked: true, tooltip: 'PANEL_NEWS_HOME', onClick: (b) => { filter.home = b.checked; } }));
  const letter = p.add(new Button(138, 17, 'Button_News_Letter', { toggle: true, checked: true, tooltip: 'PANEL_NEWS_LETTER', onClick: (b) => { filter.letter = b.checked; } }));
  void home; void letter;
  const msgs = () => co().inbox.filter((m) => (m.icon === 2 ? filter.letter : filter.home));
  let selected = null;
  const body = new ListBox(14, 221, 233, 137, { rowHeight: 14, renderRow: (r, line, x, y) => r.text(A, line, x + 2, y + 11) });
  const list = p.add(new ListBox(14, 64, 233, 138, {
    rowHeight: 14,
    renderRow: (r, m, x, y, w, sel, hover) => {
      if (sel || hover) r.rect(x, y, w, 14, sel ? 'rgba(90,60,160,0.35)' : 'rgba(90,60,160,0.15)');
      r.sprite('ListBox_News_Icons', Math.min(2, m.icon) + 2, x, y, { anchor: 'topleft' });
      r.text(m.read ? A : B, m.title, x + 16, y + 11);
    },
    onSelect: (m) => {
      selected = m;
      m.read = true;
      const text = m.body || m.title;
      body.setItems(text.split('§').flatMap((para) => hud.scene.game.r.wrap(A, para, 220)));
      body.scroll = 0;
    },
  }));
  p.add(body);
  list.onUpdate = function (dt, input) {
    ListBox.prototype.onUpdate.call(this, dt, input);
    const items = msgs();
    if (items !== this.items) {
      const sel = this.items[this.selected];
      this.items = items;
      this.selected = items.indexOf(sel);
    }
  };
  const answer = (yes) => {
    if (!selected?.yesNo || selected.answer !== null) return;
    hud.sim.newsEngine.answer(co(), selected, yes);
  };
  const ok = p.add(new Button(182, 357, 'Button_OK', { tooltip: 'PANEL_NEWS_OK', onClick: () => answer(true) }));
  const no = p.add(new Button(204, 357, 'Button_NO', { tooltip: 'PANEL_NEWS_ANNULER', onClick: () => answer(false) }));
  for (const b of [ok, no]) b.onUpdate = function (dt, input) { Button.prototype.onUpdate.call(this, dt, input); this.visible = !!selected?.yesNo && selected.answer === null; };
  ok.selfVisible = no.selfVisible = true;
  p.add(new Button(22, 389, 'Button_News_Recenter', { tooltip: 'PANEL_NEWS_RECENTER', onClick: () => {
    const ws = selected?.params?.ws;
    const idx = ws === undefined ? 0 : [2, 1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16][ws];
    hud.scene.world.recenter(Math.min(idx, RECENTER.length - 1));
  } }));
  p.add(new Button(138, 389, 'Button_News_Dustbin', { tooltip: 'PANEL_NEWS_DUSTBIN', onClick: () => {
    if (!selected) return;
    const inbox = co().inbox;
    inbox.splice(inbox.indexOf(selected), 1);
    selected = null;
    list.selected = -1;
    body.setItems([]);
  } }));
  p.add(new TextField(14, 204, 233, 14, () => (selected ? `${t('PANEL_NEWS_LISTBOX2')} - ${hud.sim && dayLabel(selected.day)}` : t('PANEL_NEWS_LISTBOX2')), { font: C }));
  p.add(new TextField(14, 48, 233, 14, () => t('PANEL_NEWS_LISTBOX1'), { font: C }));
}

function dayLabel(day) {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
