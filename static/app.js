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
        renderAtencao(stats);
        renderKPIs(stats);
        marcarPendencias(stats);
        renderGraficos(stats, empenhos, evolucao);
        renderTable();
        if (aviso) showToast('Dados atualizados', 'success');
    } catch (err) {
        document.getElementById('erroMsg').textContent = err.message;
        erroBox.hidden = false;
        if (!estadoDash.empenhos.length) {
            document.getElementById('kpis').innerHTML = '';
            document.getElementById('atencao').innerHTML = '';
            document.getElementById('tableBody').innerHTML =
                `<tr><td colspan="8" class="empty">Dados indisponíveis no momento.</td></tr>`;
            ['chartStatus', 'chartAtrasados', 'chartCredores', 'chartEvolucao', 'chartEmpenhos'].forEach(id =>
                document.getElementById(id).innerHTML = graficoVazio('Dados indisponíveis.'));
        }
    }
}

function renderCarregando() {
    document.getElementById('kpis').innerHTML = Array(6).fill('<div class="kpi skeleton"></div>').join('');
    document.getElementById('tableBody').innerHTML = linhaCarregando(8);
}

/** Barra de progresso dentro do card. */
function barraKpi(valor, cor, rotulo) {
    const p = Math.min(100, Math.max(0, parseFloat(valor) || 0));
    return `<div class="kpi-bar" role="progressbar" aria-label="${escapeHTML(rotulo)}" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${p}%;background:${cor}"></span></div>`;
}

function renderKPIs(s) {
    const atraso = s.pedidos_atrasados
        ? `<span class="text-red"><strong>${fmtNum(s.pedidos_atrasados)}</strong> atrasado${s.pedidos_atrasados > 1 ? 's' : ''}</span>`
        : 'nenhum atrasado';
    const pagoSobreLiq = s.valor_liquidado ? s.valor_pago / s.valor_liquidado * 100 : 0;
    document.getElementById('kpis').innerHTML = `
        <div class="kpi accent">
            <div class="kpi-label">Empenhos</div>
            <div class="kpi-value">${fmtNum(s.empenhos)}</div>
            <div class="kpi-sub">${fmtNum(s.empenhos_concluidos)} concluídos (${pct(s.percentual_concluidos)})</div>
            ${barraKpi(s.percentual_concluidos, 'var(--primary)', 'Empenhos concluídos')}
        </div>
        <div class="kpi slate">
            <div class="kpi-label">Empenhado</div>
            <div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div>
            <div class="kpi-sub">Entrega física ${pct(s.percentual_fisico)} · ${fmtNum(s.itens)} itens</div>
            ${barraKpi(s.percentual_fisico, 'var(--kpi-slate)', 'Entrega física dos itens')}
        </div>
        <div class="kpi teal">
            <div class="kpi-label">Liquidado</div>
            <div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div>
            <div class="kpi-sub">${pct(s.percentual_liquidado)} · a liquidar ${fmtMoneyCurto(s.valor_a_liquidar)}</div>
            ${barraKpi(s.percentual_liquidado, 'var(--liq-strong)', 'Percentual liquidado')}
        </div>
        <div class="kpi green">
            <div class="kpi-label">Pago</div>
            <div class="kpi-value">${fmtMoney(s.valor_pago)}</div>
            <div class="kpi-sub">${pct(s.percentual_pago)} do empenhado</div>
            ${barraKpi(s.percentual_pago, 'var(--green)', 'Percentual pago')}
        </div>
        <div class="kpi red">
            <div class="kpi-label">A Pagar</div>
            <div class="kpi-value">${fmtMoney(s.valor_a_pagar)}</div>
            <div class="kpi-sub">${fmtNum(s.nfs_a_pagar)} NF${s.nfs_a_pagar === 1 ? '' : 's'} aguardando pagamento</div>
            ${barraKpi(pagoSobreLiq, 'var(--green)', 'Parte do liquidado já paga')}
        </div>
        <div class="kpi amber">
            <div class="kpi-label">Pedidos em Aberto</div>
            <div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${atraso}</div>
        </div>`;
    // A fonte Inter pode demorar um instante; ajusta de novo quando ela terminar de carregar
    ajustarValores(document.getElementById('kpis'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ajustarValores(document.getElementById('kpis')));
}

/** Faixa "Precisa de atenção": o que pede ação hoje, com atalho para a lista já filtrada. */
function renderAtencao(s) {
    const itens = [];
    if (s.pedidos_atrasados) itens.push({ icone: 'alarm', cls: 'critico', filtro: 'ATRASO',
        texto: `<strong>${fmtNum(s.pedidos_atrasados)}</strong> pedido${s.pedidos_atrasados > 1 ? 's' : ''} atrasado${s.pedidos_atrasados > 1 ? 's' : ''}` });
    if (s.pedidos_vencendo) itens.push({ icone: 'calendar-due', cls: 'aviso', filtro: 'VENCENDO',
        texto: `<strong>${fmtNum(s.pedidos_vencendo)}</strong> pedido${s.pedidos_vencendo > 1 ? 's vencem' : ' vence'} em até 7 dias` });
    if (s.nfs_a_pagar) itens.push({ icone: 'cash', cls: 'info', filtro: 'APAGAR',
        texto: `<strong>${fmtNum(s.nfs_a_pagar)}</strong> NF${s.nfs_a_pagar > 1 ? 's' : ''} aguardando pagamento · ${fmtMoney(s.valor_a_pagar)}` });
    const el = document.getElementById('atencao');
    if (!itens.length) {
        el.innerHTML = s.empenhos
            ? `<div class="atencao-ok">${ico('circle-check')} Tudo em dia: nenhum pedido atrasado ou vencendo e nenhuma NF a pagar.</div>`
            : '';
        return;
    }
    el.innerHTML = `<span class="atencao-titulo">${ico('bell')} Precisa de atenção</span>` + itens.map(i => `
        <a class="atencao-item ${i.cls}" href="/empenhos?situacao=${i.filtro}">${ico(i.icone)}<span>${i.texto}</span>${ico('arrow-left', 'ico ico-seta')}</a>`).join('');
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
        stats.valor_empenhado > 0 ? 'Nada a liquidar: tudo entregue.' : 'Nenhum valor empenhado ainda.');

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
            <span class="empty-icon">${ico('inbox', 'ico ico-empty')}</span>
            Nenhum empenho cadastrado. Clique em "Empenhos", no topo, para começar.
        </td></tr>`;
        return;
    }
    tbody.innerHTML = empenhos.map(e => `
        <tr>
            <td><strong>${escapeHTML(e.ne)}</strong>
                ${e.pedidos_atrasados ? `<span class="badge critico" title="Pedidos com entrega vencida">${ico('alarm')} ${e.pedidos_atrasados}</span>` : ''}</td>
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
