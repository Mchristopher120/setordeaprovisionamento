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
 * Empenhado × Pago: barra do empenhado (trilho) com o pago preenchido por cima.
 * linhas: [{id, label, sub, empenhado, pago}]
 */
function graficoEmpenhadoPago(el, linhas) {
    if (!linhas.length) { el.innerHTML = graficoVazio('Cadastre empenhos com itens para ver este gráfico.'); return; }
    const max = Math.max(...linhas.map(l => l.empenhado)) || 1;
    el.innerHTML = `<div class="ep-list">${linhas.map(l => {
        const wEmp = (l.empenhado / max) * 100;
        const wPago = l.empenhado ? Math.min(100, (l.pago / l.empenhado) * 100) : 0;
        const p = l.empenhado ? (l.pago / l.empenhado) * 100 : 0;
        return `
        <a class="ep-row" href="/empenhos?id=${l.id}"
           title="${escapeHTML(l.label)} — Empenhado ${fmtMoney(l.empenhado)} • Pago ${fmtMoney(l.pago)} (${pct(p)})">
            <div class="ep-label">
                <strong>${escapeHTML(l.label)}</strong>
                <span>${escapeHTML(l.sub)}</span>
            </div>
            <div class="ep-bar-area">
                <div class="ep-track" style="width:${Math.max(wEmp, 1.5)}%">
                    <span class="ep-fill" style="width:${wPago}%"></span>
                </div>
            </div>
            <div class="ep-vals">
                <strong>${fmtMoneyCurto(l.pago)}</strong>
                <span>de ${fmtMoneyCurto(l.empenhado)} · ${pct(p)}</span>
            </div>
        </a>`;
    }).join('')}</div>`;
}
