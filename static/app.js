// Dashboard (página inicial)
const estadoDash = { empenhos: [], sort: { key: null, dir: 1 } };

async function loadAll({ aviso = false } = {}) {
    const erroBox = document.getElementById('erroBox');
    if (!estadoDash.empenhos.length) renderCarregando();
    try {
        const [empenhos, stats] = await Promise.all([
            fetchJSON('/api/empenhos'),
            fetchJSON('/api/stats_empenhos'),
        ]);
        erroBox.hidden = true;
        estadoDash.empenhos = empenhos;
        renderKPIs(stats);
        renderIndicadores(stats);
        renderGraficos(stats, empenhos);
        renderTable();
        if (aviso) showToast('Dados atualizados', 'success');
    } catch (err) {
        document.getElementById('erroMsg').textContent = err.message;
        erroBox.hidden = false;
        if (!estadoDash.empenhos.length) {
            document.getElementById('kpis').innerHTML = '';
            document.getElementById('indGrid').innerHTML = '';
            document.getElementById('tableBody').innerHTML =
                `<tr><td colspan="8" class="empty">Dados indisponíveis no momento.</td></tr>`;
            ['chartStatus', 'chartCredores', 'chartEmpenhos'].forEach(id =>
                document.getElementById(id).innerHTML = graficoVazio('Dados indisponíveis.'));
        }
    }
}

function renderCarregando() {
    document.getElementById('kpis').innerHTML = Array(5).fill('<div class="kpi skeleton"></div>').join('');
    document.getElementById('indGrid').innerHTML = Array(4).fill('<div class="ind-card skeleton"></div>').join('');
    document.getElementById('tableBody').innerHTML = linhaCarregando(8);
}

function renderKPIs(stats) {
    document.getElementById('kpis').innerHTML = `
        <div class="kpi accent">
            <div class="kpi-label">Empenhos</div>
            <div class="kpi-value">${fmtNum(stats.empenhos)}</div>
            <div class="kpi-sub">${fmtNum(stats.empenhos_concluidos)} concluídos</div>
        </div>
        <div class="kpi warning">
            <div class="kpi-label">Itens</div>
            <div class="kpi-value">${fmtNum(stats.itens)}</div>
            <div class="kpi-sub">${fmtNum(stats.itens_zerados)} recebidos por completo</div>
        </div>
        <div class="kpi green">
            <div class="kpi-label">Valor Empenhado</div>
            <div class="kpi-value">${fmtMoney(stats.valor_empenhado)}</div>
            <div class="kpi-sub">${pct(stats.percentual_pago)} já pago</div>
        </div>
        <div class="kpi red">
            <div class="kpi-label">A Liquidar</div>
            <div class="kpi-value">${fmtMoney(stats.valor_a_liquidar)}</div>
            <div class="kpi-sub">Saldo financeiro restante</div>
        </div>
        <div class="kpi amber">
            <div class="kpi-label">Pedidos em Aberto</div>
            <div class="kpi-value">${fmtNum(stats.pedidos_em_aberto)}</div>
            <div class="kpi-sub">Aguardando recebimento</div>
        </div>`;
}

function renderIndicadores(stats) {
    const ind = [
        {
            label: 'Pago (Financeiro)',
            pct: stats.percentual_pago,
            detail: `${fmtMoney(stats.valor_pago)} de ${fmtMoney(stats.valor_empenhado)}`,
            color: 'var(--primary)',
            icone: '💰',
        },
        {
            label: 'Recebido (Físico)',
            pct: stats.percentual_fisico,
            detail: `Média de entrega de ${fmtNum(stats.itens_com_qtde)} itens`,
            color: 'var(--green)',
            icone: '📦',
        },
        {
            label: 'Itens Recebidos por Completo',
            pct: stats.percentual_itens_zerados,
            detail: `${fmtNum(stats.itens_zerados)} de ${fmtNum(stats.itens)} itens`,
            color: 'var(--warning)',
            icone: '✅',
        },
        {
            label: 'Empenhos Concluídos',
            pct: stats.percentual_concluidos,
            detail: `${fmtNum(stats.empenhos_concluidos)} de ${fmtNum(stats.empenhos)} empenhos`,
            color: 'var(--amber)',
            icone: '🏁',
        },
    ];

    document.getElementById('indGrid').innerHTML = ind.map(i => {
        const p = Math.min(100, Math.max(0, i.pct || 0));
        return `
        <div class="ind-card">
            <div class="ind-head">
                <span class="ind-icon">${i.icone}</span>
                <span class="ind-label">${escapeHTML(i.label)}</span>
            </div>
            <div class="ind-value" style="color:${i.color}">${pct(i.pct)}</div>
            <div class="ind-bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100">
                <span style="width:${p}%;background:${i.color}"></span>
            </div>
            <div class="ind-detail">${escapeHTML(i.detail)}</div>
        </div>`;
    }).join('');
}

function renderGraficos(stats, empenhos) {
    const sp = stats.status_pedidos || {};
    graficoRosca(document.getElementById('chartStatus'), [
        { label: 'Aguardando (incluído)', value: sp.INCLUIDO || 0, color: 'var(--info)' },
        { label: 'Recebido parcial', value: sp.PARCIAL || 0, color: 'var(--amber)' },
        { label: 'Recebido', value: sp.RECEBIDO || 0, color: 'var(--green)' },
    ], 'pedidos');

    // Saldo a liquidar agrupado por credor
    const porCredor = {};
    empenhos.forEach(e => {
        const k = e.nome_credor || '—';
        porCredor[k] = porCredor[k] || { valor: 0, qtd: 0 };
        porCredor[k].valor += e.a_liquidar || 0;
        porCredor[k].qtd += 1;
    });
    const credores = Object.entries(porCredor)
        .filter(([, v]) => v.valor > 0.005)
        .sort((a, b) => b[1].valor - a[1].valor)
        .slice(0, 5)
        .map(([nome, v]) => ({
            label: nome, value: v.valor, texto: fmtMoney(v.valor),
            sub: `${fmtNum(v.qtd)} empenho${v.qtd > 1 ? 's' : ''}`,
        }));
    graficoRanking(document.getElementById('chartCredores'), credores, 'var(--red)',
        stats.valor_empenhado > 0 ? 'Nenhum saldo a liquidar. Tudo pago! 🎉' : 'Nenhum valor empenhado ainda.');

    const top = empenhos
        .filter(e => e.valor_empenhado > 0)
        .sort((a, b) => b.valor_empenhado - a.valor_empenhado)
        .slice(0, 8)
        .map(e => ({ id: e.id, label: e.ne, sub: e.nome_credor, empenhado: e.valor_empenhado, pago: e.valor_pago }));
    graficoEmpenhadoPago(document.getElementById('chartEmpenhos'), top);
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    const empenhos = ordenar(estadoDash.empenhos, estadoDash.sort.key, estadoDash.sort.dir);
    document.getElementById('countBadge').textContent =
        `${fmtNum(empenhos.length)} empenho${empenhos.length === 1 ? '' : 's'}`;

    if (!empenhos.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty">
            <span class="empty-icon">📦</span>
            Nenhum empenho cadastrado. Clique em "📦 Empenhos" para começar.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = empenhos.map(e => `
        <tr>
            <td><strong>${escapeHTML(e.ne)}</strong></td>
            <td>${escapeHTML(e.nome_credor)}</td>
            <td>${escapeHTML(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red">${fmtMoney(e.a_liquidar)}</td>
            <td>${pctCell(e.percentual_pago)}</td>
            <td><a href="/empenhos?id=${e.id}" class="btn btn-sm btn-secondary">Abrir</a></td>
        </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    ativarOrdenacao(document.getElementById('dataTable'), estadoDash.sort, renderTable);
    document.getElementById('btnRefresh').addEventListener('click', () => loadAll({ aviso: true }));
    document.getElementById('btnTentar').addEventListener('click', () => loadAll({ aviso: true }));
    loadAll();
});
