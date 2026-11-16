// Dashboard (página inicial). De cima para baixo: o que pede ação, os números do setor,
// onde agir (entregas, pedidos, fornecedores) e o panorama (evolução e execução).
const estadoDash = { empenhos: [], carregou: false, execTodos: false };

async function loadAll({ aviso = false } = {}) {
    const erroBox = document.getElementById('erroBox');
    if (!estadoDash.carregou) renderCarregando();
    try {
        const [empenhos, stats, evolucao] = await Promise.all([
            fetchJSON('/api/empenhos'),
            fetchJSON('/api/stats_empenhos'),
            fetchJSON('/api/evolucao'),
        ]);
        erroBox.hidden = true;
        estadoDash.empenhos = empenhos;
        estadoDash.carregou = true;
        const vazio = !empenhos.length;
        document.getElementById('boasVindas').hidden = !vazio;
        document.querySelectorAll('.so-com-dados').forEach(el => el.classList.toggle('oculto', vazio));
        const agora = new Date();
        const dia = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
        document.getElementById('dashSub').textContent =
            `${dia.charAt(0).toUpperCase() + dia.slice(1)} · atualizado às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        renderAtencao(stats);
        renderKPIs(stats);
        marcarPendencias(stats);
        renderGraficos(stats, empenhos, evolucao);
        if (aviso) showToast('Dados atualizados', 'success');
    } catch (err) {
        document.getElementById('erroMsg').textContent = err.message;
        erroBox.hidden = false;
        if (!estadoDash.carregou) {
            document.getElementById('kpis').innerHTML = '';
            document.getElementById('atencao').innerHTML = '';
            ['chartEntregas', 'chartStatus', 'chartCredores', 'chartEvolucao', 'chartEmpenhos'].forEach(id =>
                document.getElementById(id).innerHTML = graficoVazio('Dados indisponíveis.'));
        }
    }
}

function renderCarregando() {
    document.getElementById('kpis').innerHTML = Array(5).fill('<div class="kpi skeleton"></div>').join('');
    ['chartEntregas', 'chartStatus', 'chartCredores'].forEach(id => {
        document.getElementById(id).innerHTML = '<div class="skeleton skeleton-bloco"></div>';
    });
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
        : (s.pedidos_vencendo ? `${fmtNum(s.pedidos_vencendo)} vence${s.pedidos_vencendo > 1 ? 'm' : ''} em até 7 dias` : 'nenhum atrasado');
    const pagoSobreLiq = s.valor_liquidado ? s.valor_pago / s.valor_liquidado * 100 : 0;
    document.getElementById('kpis').innerHTML = `
        <a class="kpi kpi-link slate" href="/empenhos">
            <div class="kpi-label">Empenhado</div>
            <div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div>
            <div class="kpi-sub">${fmtNum(s.empenhos)} empenho${s.empenhos === 1 ? '' : 's'} · ${pct(s.percentual_fisico)} entregue</div>
            ${barraKpi(s.percentual_fisico, 'var(--kpi-slate)', 'Entrega física dos itens')}
        </a>
        <div class="kpi teal">
            <div class="kpi-label">Liquidado</div>
            <div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div>
            <div class="kpi-sub" title="Falta liquidar ${fmtMoney(s.valor_a_liquidar)}">${pct(s.percentual_liquidado)} do empenhado</div>
            ${barraKpi(s.percentual_liquidado, 'var(--liq)', 'Percentual liquidado')}
        </div>
        <div class="kpi green">
            <div class="kpi-label">Pago</div>
            <div class="kpi-value">${fmtMoney(s.valor_pago)}</div>
            <div class="kpi-sub">${pct(pagoSobreLiq)} do liquidado</div>
            ${barraKpi(pagoSobreLiq, 'var(--green)', 'Parte do liquidado já paga')}
        </div>
        <a class="kpi kpi-link amber" href="/empenhos?situacao=APAGAR">
            <div class="kpi-label">A pagar</div>
            <div class="kpi-value">${fmtMoney(s.valor_a_pagar)}</div>
            <div class="kpi-sub">${s.nfs_a_pagar ? `${fmtNum(s.nfs_a_pagar)} NF${s.nfs_a_pagar === 1 ? '' : 's'} aguardando pagamento` : 'nenhuma NF pendente'}</div>
        </a>
        <a class="kpi kpi-link ${s.pedidos_atrasados ? 'red' : 'accent'}" href="/empenhos?situacao=ABERTO">
            <div class="kpi-label">Pedidos em aberto</div>
            <div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${atraso}</div>
        </a>`;
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
        <a class="atencao-item ${i.cls}" href="/empenhos?situacao=${i.filtro}">${ico(i.icone)}<span>${i.texto}</span>${ico('arrow-right', 'ico ico-seta')}</a>`).join('');
}

/** Agenda de entregas: atrasadas primeiro (mais antigas no topo), depois as próximas a vencer. */
function renderEntregas(stats) {
    const el = document.getElementById('chartEntregas');
    const atr = stats.lista_atrasados || [], prox = stats.proximas_entregas || [];
    const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    if (!atr.length && !prox.length) {
        el.innerHTML = `<div class="chart-empty ${stats.pedidos_em_aberto ? '' : 'ok'}">${ico(stats.pedidos_em_aberto ? 'calendar-due' : 'circle-check', 'ico ico-empty')}
            ${stats.pedidos_em_aberto ? `Os ${fmtNum(stats.pedidos_em_aberto)} pedidos em aberto estão sem prazo de entrega. Informe o prazo no pedido para acompanhar aqui.` : 'Nenhuma entrega pendente.'}</div>`;
        return;
    }
    const linha = (p, atrasado) => {
        const [, m, d] = (p.vencimento || '').split('-');
        const quando = atrasado ? `${fmtNum(p.dias_atraso)} dia${p.dias_atraso > 1 ? 's' : ''} de atraso`
            : p.dias_restantes === 0 ? 'vence hoje' : p.dias_restantes === 1 ? 'vence amanhã' : `em ${fmtNum(p.dias_restantes)} dias`;
        return `<li><a class="entrega ${atrasado ? 'atrasada' : (p.dias_restantes <= 7 ? 'perto' : '')}" href="/empenhos?id=${p.empenho_id}">
            <span class="entrega-data"><strong>${d || '—'}</strong>${MES[+m - 1] || ''}</span>
            <span class="entrega-info"><strong>${escapeHTML(p.nome_credor)}</strong><span>${escapeHTML(p.numero_pedido)} · ${escapeHTML(p.ne)}</span></span>
            <span class="entrega-quando">${quando}</span></a></li>`;
    };
    const limite = 5;
    const itens = [...atr.map(p => linha(p, true)), ...prox.map(p => linha(p, false))];
    const resto = (stats.pedidos_atrasados || 0) + prox.length - Math.min(itens.length, limite);
    el.innerHTML = `<ul class="entregas">${itens.slice(0, limite).join('')}</ul>
        ${resto > 0 || stats.pedidos_sem_prazo ? `<p class="muted small entregas-nota">${[
            resto > 0 && `mais ${fmtNum(resto)} na lista de pedidos em aberto`,
            stats.pedidos_sem_prazo && `${fmtNum(stats.pedidos_sem_prazo)} pedido${stats.pedidos_sem_prazo > 1 ? 's' : ''} sem prazo informado`,
        ].filter(Boolean).join(' · ')}</p>` : ''}`;
}

function renderGraficos(stats, empenhos, evolucao) {
    renderEntregas(stats);
    const sp = stats.status_pedidos || {};
    graficoRosca(document.getElementById('chartStatus'), [
        { label: 'Em aberto', value: sp.INCLUIDO || 0, color: 'var(--primary)' },
        { label: 'Parcial', value: sp.PARCIAL || 0, color: 'var(--amber)' },
        { label: 'Recebido', value: sp.RECEBIDO || 0, color: 'var(--green)' },
        { label: 'Encerrado', value: sp.ENCERRADO || 0, color: 'var(--slate)' },
    ], 'pedidos');

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
            label: nome, value: v.valor, texto: fmtMoney(v.valor), href: `/empenhos?fornecedor=${encodeURIComponent(nome)}`,
            sub: `${fmtNum(v.qtd)} empenho${v.qtd > 1 ? 's' : ''}`,
        }));
    graficoRanking(document.getElementById('chartCredores'), credores, 'var(--primary)',
        stats.valor_empenhado > 0 ? 'Nada a liquidar: tudo entregue.' : 'Nenhum valor empenhado ainda.');

    graficoEvolucao(document.getElementById('chartEvolucao'), evolucao);
    renderExecucao();
}

/** Execução por empenho: os 8 maiores; "ver todos" abre o resto na própria tela. */
function renderExecucao() {
    const todos = estadoDash.empenhos.filter(e => e.valor_empenhado > 0).sort((a, b) => b.valor_empenhado - a.valor_empenhado);
    const top = (estadoDash.execTodos ? todos : todos.slice(0, 8))
        .map(e => ({ id: e.id, label: e.ne, sub: e.nome_credor, empenhado: e.valor_empenhado,
                     liquidado: e.valor_liquidado, pago: e.valor_pago }));
    graficoExecucao(document.getElementById('chartEmpenhos'), top);
    const rod = document.getElementById('execRodape');
    rod.hidden = todos.length <= 8;
    rod.innerHTML = `<button type="button" class="btn btn-link btn-sm" id="btnExecTodos">${estadoDash.execTodos ? 'Mostrar só os 8 maiores' : `Mostrar os ${fmtNum(todos.length)} empenhos`}</button>`;
    const b = document.getElementById('btnExecTodos');
    if (b) b.addEventListener('click', () => { estadoDash.execTodos = !estadoDash.execTodos; renderExecucao(); });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnRefresh').addEventListener('click', () => loadAll({ aviso: true }));
    document.getElementById('btnTentar').addEventListener('click', () => loadAll({ aviso: true }));
    loadAll();
});
