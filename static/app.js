// Dashboard (página inicial)
const estadoDash = { empenhos: [], sort: { key: null, dir: 1 } };

async function loadAll({ aviso = false } = {}) {
    const erroBox = document.getElementById('erroBox');
    if (!estadoDash.empenhos.length) renderCarregando();
    try {
        const [empenhos, stats, evolucao] = await Promise.all([
            fetchJSON('/api/empenhos'),
            fetchJSON('/api/stats_empenhos'),
            fetchJSON('/api/evolucao'),
        ]);
        erroBox.hidden = true;
        estadoDash.empenhos = empenhos;
        renderKPIs(stats);
        renderIndicadores(stats);
        renderGraficos(stats, empenhos, evolucao);
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
            ['chartStatus', 'chartAtrasados', 'chartCredores', 'chartEvolucao', 'chartEmpenhos'].forEach(id =>
                document.getElementById(id).innerHTML = graficoVazio('Dados indisponíveis.'));
        }
    }
}

function renderCarregando() {
    document.getElementById('kpis').innerHTML = Array(6).fill('<div class="kpi skeleton"></div>').join('');
    document.getElementById('indGrid').innerHTML = Array(4).fill('<div class="ind-card skeleton"></div>').join('');
    document.getElementById('tableBody').innerHTML = linhaCarregando(8);
}

function renderKPIs(s) {
    const atraso = s.pedidos_atrasados
        ? `<span class="text-red"><strong>${fmtNum(s.pedidos_atrasados)}</strong> atrasado${s.pedidos_atrasados > 1 ? 's' : ''}</span>`
        : 'nenhum atrasado';
    document.getElementById('kpis').innerHTML = `
        <div class="kpi accent">
            <div class="kpi-label">Empenhos</div>
            <div class="kpi-value">${fmtNum(s.empenhos)}</div>
            <div class="kpi-sub">${fmtNum(s.empenhos_concluidos)} concluídos · ${fmtNum(s.itens)} itens</div>
        </div>
        <div class="kpi slate">
            <div class="kpi-label">Empenhado</div>
            <div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div>
            <div class="kpi-sub">Valor total dos itens</div>
        </div>
        <div class="kpi teal">
            <div class="kpi-label">Liquidado</div>
            <div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div>
            <div class="kpi-sub">${pct(s.percentual_liquidado)} · a liquidar ${fmtMoneyCurto(s.valor_a_liquidar)}</div>
        </div>
        <div class="kpi green">
            <div class="kpi-label">Pago</div>
            <div class="kpi-value">${fmtMoney(s.valor_pago)}</div>
            <div class="kpi-sub">${pct(s.percentual_pago)} do empenhado</div>
        </div>
        <div class="kpi red">
            <div class="kpi-label">A Pagar</div>
            <div class="kpi-value">${fmtMoney(s.valor_a_pagar)}</div>
            <div class="kpi-sub">NFs recebidas ainda não pagas</div>
        </div>
        <div class="kpi amber">
            <div class="kpi-label">Pedidos em Aberto</div>
            <div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${atraso}</div>
        </div>`;
}

function renderIndicadores(s) {
    const ind = [
        { label: 'Liquidado', pct: s.percentual_liquidado, color: 'var(--liq-strong)', icone: '🧾',
          detail: `${fmtMoney(s.valor_liquidado)} de ${fmtMoney(s.valor_empenhado)}` },
        { label: 'Pago', pct: s.percentual_pago, color: 'var(--green)', icone: '💰',
          detail: `${fmtMoney(s.valor_pago)} de ${fmtMoney(s.valor_empenhado)}` },
        { label: 'Recebido (Físico)', pct: s.percentual_fisico, color: 'var(--primary)', icone: '📦',
          detail: `Média de entrega de ${fmtNum(s.itens_com_qtde)} itens · ${fmtNum(s.itens_zerados)} completos` },
        { label: 'Empenhos Concluídos', pct: s.percentual_concluidos, color: 'var(--amber)', icone: '🏁',
          detail: `${fmtNum(s.empenhos_concluidos)} de ${fmtNum(s.empenhos)} empenhos` },
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

function renderGraficos(stats, empenhos, evolucao) {
    const sp = stats.status_pedidos || {};
    graficoRosca(document.getElementById('chartStatus'), [
        { label: 'Aguardando', value: sp.INCLUIDO || 0, color: 'var(--info)' },
        { label: 'Parcial', value: sp.PARCIAL || 0, color: 'var(--amber)' },
        { label: 'Recebido', value: sp.RECEBIDO || 0, color: 'var(--green)' },
        { label: 'Encerrado', value: sp.ENCERRADO || 0, color: 'var(--slate)' },
    ], 'pedidos');

    listaAtrasados(document.getElementById('chartAtrasados'), stats.lista_atrasados || [], stats.pedidos_atrasados || 0);

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
        stats.valor_empenhado > 0 ? 'Nada a liquidar. Tudo entregue! 🎉' : 'Nenhum valor empenhado ainda.');

    graficoEvolucao(document.getElementById('chartEvolucao'), evolucao);

    const top = empenhos
        .filter(e => e.valor_empenhado > 0)
        .sort((a, b) => b.valor_empenhado - a.valor_empenhado)
        .slice(0, 8)
        .map(e => ({ id: e.id, label: e.ne, sub: e.nome_credor, empenhado: e.valor_empenhado,
                     liquidado: e.valor_liquidado, pago: e.valor_pago }));
    graficoExecucao(document.getElementById('chartEmpenhos'), top);
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
            <td><strong>${escapeHTML(e.ne)}</strong>
                ${e.pedidos_atrasados ? `<span class="badge critico" title="Pedidos com entrega vencida">⏰ ${e.pedidos_atrasados}</span>` : ''}</td>
            <td>${escapeHTML(e.nome_credor)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-teal">${fmtMoney(e.valor_liquidado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red">${fmtMoney(e.a_liquidar)}</td>
            <td>${pctCell(e.percentual_liquidado)}</td>
            <td><a href="/empenhos?id=${e.id}" class="btn btn-sm btn-secondary">Abrir</a></td>
        </tr>`).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    ativarOrdenacao(document.getElementById('dataTable'), estadoDash.sort, renderTable);
    document.getElementById('btnRefresh').addEventListener('click', () => loadAll({ aviso: true }));
    document.getElementById('btnTentar').addEventListener('click', () => loadAll({ aviso: true }));
    loadAll();
});
