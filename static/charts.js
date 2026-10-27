// Gráficos leves em SVG/HTML puro (sem bibliotecas externas: funciona offline).

function graficoVazio(msg) {
    return `<div class="chart-empty"><span>📊</span>${escapeHTML(msg)}</div>`;
}

/**
 * Rosca (donut).
 * segmentos: [{label, value, color}]
 */
function graficoRosca(el, segmentos, rotuloCentro) {
    const total = segmentos.reduce((a, s) => a + (s.value || 0), 0);
    if (!total) { el.innerHTML = graficoVazio('Nenhum pedido registrado ainda.'); return; }

    const R = 70, C = 2 * Math.PI * R, ESP = 22;
    const gap = segmentos.filter(s => s.value > 0).length > 1 ? 3 : 0; // respiro entre fatias
    let offset = 0;
    const arcos = segmentos.map((s, idx) => {
        if (!s.value) return '';
        const len = (s.value / total) * C;
        const arco = `<circle class="donut-seg" data-idx="${idx}" r="${R}" cx="90" cy="90" fill="none"
            stroke="${s.color}" stroke-width="${ESP}"
            stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-offset}">
            <title>${escapeHTML(s.label)}: ${fmtNum(s.value)} (${pct(s.value / total * 100)})</title>
        </circle>`;
        offset += len;
        return arco;
    }).join('');

    el.innerHTML = `
    <div class="donut-wrap">
        <svg viewBox="0 0 180 180" class="donut" role="img" aria-label="${escapeHTML(rotuloCentro)}: ${fmtNum(total)}">
            <circle r="${R}" cx="90" cy="90" fill="none" stroke="var(--track)" stroke-width="${ESP}"/>
            <g transform="rotate(-90 90 90)">${arcos}</g>
            <text x="90" y="88" text-anchor="middle" class="donut-total">${fmtNum(total)}</text>
            <text x="90" y="110" text-anchor="middle" class="donut-label">${escapeHTML(rotuloCentro)}</text>
        </svg>
        <ul class="donut-legend">
            ${segmentos.map((s, idx) => `
            <li data-idx="${idx}">
                <i style="background:${s.color}"></i>
                <span class="lg-label">${escapeHTML(s.label)}</span>
                <strong>${fmtNum(s.value)}</strong>
                <span class="lg-pct">${pct(s.value / total * 100)}</span>
            </li>`).join('')}
        </ul>
    </div>`;

    // Destaque cruzado legenda <-> fatia
    const marcar = (idx, on) => {
        el.querySelectorAll(`[data-idx="${idx}"]`).forEach(n => n.classList.toggle('hl', on));
        el.querySelector('.donut').classList.toggle('dim', on);
    };
    el.querySelectorAll('[data-idx]').forEach(n => {
        n.addEventListener('mouseenter', () => marcar(n.dataset.idx, true));
        n.addEventListener('mouseleave', () => marcar(n.dataset.idx, false));
    });
}

/**
 * Ranking em barras horizontais.
 * linhas: [{label, sub, value, texto}]
 */
function graficoRanking(el, linhas, cor, msgVazio) {
    if (!linhas.length) { el.innerHTML = graficoVazio(msgVazio); return; }
    const max = Math.max(...linhas.map(l => l.value)) || 1;
    el.innerHTML = `<ol class="rank">${linhas.map((l, i) => `
        <li title="${escapeHTML(l.label)}: ${escapeHTML(l.texto)}">
            <span class="rank-pos">${i + 1}</span>
            <div class="rank-body">
                <div class="rank-top">
                    <span class="rank-label">${escapeHTML(l.label)}</span>
                    <strong class="rank-val">${escapeHTML(l.texto)}</strong>
                </div>
                <div class="bar"><span style="width:${(l.value / max) * 100}%;background:${cor}"></span></div>
                ${l.sub ? `<div class="rank-sub">${escapeHTML(l.sub)}</div>` : ''}
            </div>
        </li>`).join('')}</ol>`;
}

/**
 * Execução por empenho: trilho = empenhado; por cima, o liquidado (claro)
 * e o pago (escuro), ambos medidos a partir do início da barra.
 * linhas: [{id, label, sub, empenhado, liquidado, pago}]
 */
function graficoExecucao(el, linhas) {
    if (!linhas.length) { el.innerHTML = graficoVazio('Cadastre empenhos com itens para ver este gráfico.'); return; }
    const max = Math.max(...linhas.map(l => l.empenhado)) || 1;
    const larg = (v, base) => base ? Math.min(100, (v / base) * 100) : 0;
    el.innerHTML = `<div class="ep-list">${linhas.map(l => {
        const pLiq = l.empenhado ? (l.liquidado / l.empenhado) * 100 : 0;
        const pPago = l.empenhado ? (l.pago / l.empenhado) * 100 : 0;
        return `
        <a class="ep-row" href="/empenhos?id=${l.id}"
           title="${escapeHTML(l.label)} — Empenhado ${fmtMoney(l.empenhado)} • Liquidado ${fmtMoney(l.liquidado)} (${pct(pLiq)}) • Pago ${fmtMoney(l.pago)} (${pct(pPago)})">
            <div class="ep-label">
                <strong>${escapeHTML(l.label)}</strong>
                <span>${escapeHTML(l.sub)}</span>
            </div>
            <div class="ep-bar-area">
                <div class="ep-track" style="width:${Math.max((l.empenhado / max) * 100, 1.5)}%">
                    <span class="ep-fill ep-liq" style="width:${larg(l.liquidado, l.empenhado)}%"></span>
                    <span class="ep-fill ep-pago" style="width:${larg(l.pago, l.empenhado)}%"></span>
                </div>
            </div>
            <div class="ep-vals">
                <strong>${pct(pLiq)} liquidado</strong>
                <span>${pct(pPago)} pago · de ${fmtMoneyCurto(l.empenhado)}</span>
            </div>
        </a>`;
    }).join('')}</div>`;
}

/**
 * Colunas mensais (liquidado × pago).
 * meses: [{mes:'2026-10', liquidado, pago}]
 */
function graficoEvolucao(el, meses) {
    const max = Math.max(0, ...meses.map(m => Math.max(m.liquidado, m.pago)));
    if (!max) { el.innerHTML = graficoVazio('Sem liquidações ou pagamentos nos últimos 12 meses.'); return; }
    // Escala "redonda" para as linhas de grade
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const topo = [1, 2, 2.5, 5, 10].map(f => f * mag).find(v => v >= max);
    const grades = [0, 0.25, 0.5, 0.75, 1];
    const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    el.innerHTML = `
    <div class="evo">
        <div class="evo-grid">
            ${grades.map(f => `<div class="evo-line" style="bottom:${f * 100}%"><span>${fmtMoneyCurto(topo * f)}</span></div>`).join('')}
        </div>
        <div class="evo-cols">
            ${meses.map(m => {
                const [a, mm] = m.mes.split('-');
                const rot = `${NOMES[+mm - 1]}/${a.slice(2)}`;
                return `
                <div class="evo-col" tabindex="0" title="${rot} — Liquidado ${fmtMoney(m.liquidado)} • Pago ${fmtMoney(m.pago)}">
                    <div class="evo-bars">
                        <span class="evo-bar liq" style="height:${(m.liquidado / topo) * 100}%"></span>
                        <span class="evo-bar pago" style="height:${(m.pago / topo) * 100}%"></span>
                    </div>
                    <span class="evo-mes">${rot}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
}

/** Lista de pedidos atrasados (mais atrasados primeiro). */
function listaAtrasados(el, itens, total) {
    if (!itens.length) {
        el.innerHTML = `<div class="chart-empty ok"><span>✅</span>Nenhum pedido atrasado.</div>`;
        return;
    }
    el.innerHTML = `<ul class="atrasos">${itens.map(a => `
        <li>
            <a href="/empenhos?id=${a.empenho_id}">
                <span class="atraso-dias"><strong>${fmtNum(a.dias_atraso)}</strong> dia${a.dias_atraso > 1 ? 's' : ''}</span>
                <span class="atraso-info">
                    <strong>${escapeHTML(a.numero_pedido)} · ${escapeHTML(a.ne)}</strong>
                    <span>${escapeHTML(a.nome_credor)} — venceu em ${dataBR(a.vencimento)}</span>
                </span>
            </a>
        </li>`).join('')}</ul>
        ${total > itens.length ? `<p class="muted small">+ ${total - itens.length} outro(s) — veja na tela de Empenhos.</p>` : ''}`;
}
