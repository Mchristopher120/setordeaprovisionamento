// Dashboard (página inicial)
//
// Perguntas que esta tela responde, nesta ordem:
//   1. O que pede ação hoje?           -> faixa "Precisa de atenção" (pedidos atrasados/vencendo, NFs a pagar, estoque)
//   2. Como está a execução?           -> números-chave (empenhado, liquidado, a pagar, pedidos, estoque)
//   3. Onde agir?                      -> pedidos, fornecedores com mais saldo a liquidar, produtos a repor
//   4. Panorama                        -> curva ABC do estoque e evolução mensal
//   5. Qual empenho abrir?             -> tabela dos empenhos com saldo a liquidar
// O filtro "Exercício" vale para tudo que é de empenho; o estoque não tem exercício (é consumo real).
const estadoDash = { empenhos: [], sort: { key: 'a_liquidar', dir: -1 }, ano: '', limite: 10, verTodos: false };
const CHAVE_ANO = 'aprov-dash-exercicio';
let abcDash = null;

function lerAnoSalvo() { try { return localStorage.getItem(CHAVE_ANO) || ''; } catch { return ''; } }
function salvarAno(v) { try { localStorage.setItem(CHAVE_ANO, v); } catch { /* sem armazenamento: tudo bem */ } }

async function loadAll({ aviso = false } = {}) {
    const erroBox = document.getElementById('erroBox');
    if (!estadoDash.empenhos.length) renderCarregando();
    const q = estadoDash.ano ? `?ano=${encodeURIComponent(estadoDash.ano)}` : '';
    try {
        const [empenhos, stats, evolucao, estoque] = await Promise.all([
            fetchJSON('/api/empenhos'),
            fetchJSON(`/api/stats_empenhos${q}`),
            fetchJSON(`/api/evolucao${q}`),
            fetchJSON('/api/estoque').catch(() => null), // o estoque é opcional para o painel
        ]);
        erroBox.hidden = true;
        estadoDash.empenhos = estadoDash.ano ? empenhos.filter(e => e.ano === estadoDash.ano) : empenhos;
        abcDash = estoque;
        preencherExercicios(stats.anos || []);
        const vazio = !empenhos.length;
        document.getElementById('boasVindas').hidden = !vazio;
        // Primeiro uso: só o convite para começar (painéis vazios seriam ruído)
        document.querySelectorAll('.so-com-dados').forEach(el => el.classList.toggle('oculto', vazio));
        document.getElementById('dashSub').textContent =
            `${estadoDash.ano ? `Exercício ${estadoDash.ano}` : 'Todos os exercícios'} · atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        renderAtencao(stats, estoque);
        renderKPIs(stats, estoque);
        if (!estadoDash.ano) marcarPendencias(stats);
        else fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => {});
        renderGraficos(stats, estadoDash.empenhos, evolucao);
        renderRepor(estoque);
        renderAbcDash();
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
            ['chartStatus', 'chartAtrasados', 'chartCredores', 'listaRepor', 'chartEvolucao', 'chartAbcDash'].forEach(id =>
                document.getElementById(id).innerHTML = graficoVazio('Dados indisponíveis.'));
        }
    }
}

function preencherExercicios(anos) {
    const sel = document.getElementById('fExercicio');
    const atual = estadoDash.ano;
    sel.innerHTML = '<option value="">Todos</option>' + anos.map(a => `<option ${a === atual ? 'selected' : ''}>${escapeHTML(a)}</option>`).join('');
    if (atual && !anos.includes(atual)) { estadoDash.ano = ''; sel.value = ''; salvarAno(''); }
}

function renderCarregando() {
    document.getElementById('kpis').innerHTML = Array(5).fill('<div class="kpi skeleton"></div>').join('');
    document.getElementById('tableBody').innerHTML = linhaCarregando(8);
    ['chartStatus', 'chartCredores', 'listaRepor'].forEach(id => {
        document.getElementById(id).innerHTML = '<div class="skeleton skeleton-bloco"></div>';
    });
}

/** Barra de progresso dentro do card. */
function barraKpi(valor, cor, rotulo) {
    const p = Math.min(100, Math.max(0, parseFloat(valor) || 0));
    return `<div class="kpi-bar" role="progressbar" aria-label="${escapeHTML(rotulo)}" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100">
        <span style="width:${p}%;background:${cor}"></span></div>`;
}

function renderKPIs(s, est) {
    const pagoSobreLiq = s.valor_liquidado ? s.valor_pago / s.valor_liquidado * 100 : 0;
    const atraso = s.pedidos_atrasados
        ? `<span class="text-red"><strong>${fmtNum(s.pedidos_atrasados)}</strong> atrasado${s.pedidos_atrasados > 1 ? 's' : ''}</span>`
        : (s.pedidos_vencendo ? `${fmtNum(s.pedidos_vencendo)} vence${s.pedidos_vencendo > 1 ? 'm' : ''} em até 7 dias` : 'nenhum atrasado');
    const r = est && est.resumo;
    const repor = r ? r.pedir + r.criticos : 0;
    const kpiEstoque = !r || !r.produtos
        ? `<a class="kpi teal kpi-link" href="/estoque#vinculos"><div class="kpi-label">Estoque a repor</div><div class="kpi-value">—</div>
            <div class="kpi-sub">ligue os itens aos produtos</div></a>`
        : `<a class="kpi teal kpi-link" href="/estoque"><div class="kpi-label">Estoque a repor</div><div class="kpi-value">${fmtNum(repor)}</div>
            <div class="kpi-sub">${r.criticos ? `<span class="text-red"><strong>${fmtNum(r.criticos)}</strong> abaixo do mínimo</span>` : `de ${fmtNum(r.produtos)} produtos`}</div></a>`;
    document.getElementById('kpis').innerHTML = `
        <a class="kpi slate kpi-link" href="/empenhos">
            <div class="kpi-label">Empenhado</div>
            <div class="kpi-value">${fmtMoney(s.valor_empenhado)}</div>
            <div class="kpi-sub">${fmtNum(s.empenhos)} empenho${s.empenhos === 1 ? '' : 's'} · ${pct(s.percentual_fisico)} entregue</div>
            ${barraKpi(s.percentual_fisico, 'var(--kpi-slate)', 'Entrega física dos itens')}
        </a>
        <div class="kpi accent">
            <div class="kpi-label">Liquidado</div>
            <div class="kpi-value">${fmtMoney(s.valor_liquidado)}</div>
            <div class="kpi-sub">${pct(s.percentual_liquidado)} do empenhado · falta ${fmtMoneyCurto(s.valor_a_liquidar)}</div>
            ${barraKpi(s.percentual_liquidado, 'var(--liq-strong)', 'Percentual liquidado')}
        </div>
        <a class="kpi red kpi-link" href="/empenhos?situacao=APAGAR">
            <div class="kpi-label">A pagar</div>
            <div class="kpi-value">${fmtMoney(s.valor_a_pagar)}</div>
            <div class="kpi-sub">${fmtNum(s.nfs_a_pagar)} NF${s.nfs_a_pagar === 1 ? '' : 's'} · pago ${fmtMoneyCurto(s.valor_pago)} (${pct(pagoSobreLiq)} do liquidado)</div>
            ${barraKpi(pagoSobreLiq, 'var(--green)', 'Parte do liquidado já paga')}
        </a>
        <a class="kpi amber kpi-link" href="/empenhos?situacao=ABERTO">
            <div class="kpi-label">Pedidos em aberto</div>
            <div class="kpi-value">${fmtNum(s.pedidos_em_aberto)}</div>
            <div class="kpi-sub">${atraso}</div>
        </a>
        ${kpiEstoque}`;
    ajustarValores(document.getElementById('kpis'));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ajustarValores(document.getElementById('kpis')));
}

/** Faixa "Precisa de atenção": o que pede ação hoje, com atalho para a lista já filtrada. */
function renderAtencao(s, est) {
    const itens = [];
    if (s.pedidos_atrasados) itens.push({ icone: 'alarm', cls: 'critico', href: '/empenhos?situacao=ATRASO',
        texto: `<strong>${fmtNum(s.pedidos_atrasados)}</strong> pedido${s.pedidos_atrasados > 1 ? 's' : ''} atrasado${s.pedidos_atrasados > 1 ? 's' : ''}` });
    const r = est && est.resumo;
    if (r && r.criticos) itens.push({ icone: 'building-warehouse', cls: 'critico', href: '/estoque?situacao=CRITICO',
        texto: `<strong>${fmtNum(r.criticos)}</strong> produto${r.criticos > 1 ? 's' : ''} abaixo do mínimo` });
    if (s.pedidos_vencendo) itens.push({ icone: 'calendar-due', cls: 'aviso', href: '/empenhos?situacao=VENCENDO',
        texto: `<strong>${fmtNum(s.pedidos_vencendo)}</strong> pedido${s.pedidos_vencendo > 1 ? 's vencem' : ' vence'} em até 7 dias` });
    if (r && r.pedir) itens.push({ icone: 'package', cls: 'aviso', href: '/estoque?situacao=PEDIR',
        texto: `<strong>${fmtNum(r.pedir)}</strong> produto${r.pedir > 1 ? 's' : ''} no ponto de pedido` });
    if (s.nfs_a_pagar) itens.push({ icone: 'cash', cls: 'info', href: '/empenhos?situacao=APAGAR',
        texto: `<strong>${fmtNum(s.nfs_a_pagar)}</strong> NF${s.nfs_a_pagar > 1 ? 's' : ''} aguardando pagamento · ${fmtMoney(s.valor_a_pagar)}` });
    if (r && r.itens_sem_produto) itens.push({ icone: 'link', cls: 'info', href: '/estoque#vinculos',
        texto: `<strong>${fmtNum(r.itens_sem_produto)}</strong> ite${r.itens_sem_produto > 1 ? 'ns' : 'm'} de empenho sem produto no estoque` });
    const el = document.getElementById('atencao');
    if (!itens.length) {
        el.innerHTML = s.empenhos
            ? `<div class="atencao-ok">${ico('circle-check')} Tudo em dia: nenhum pedido atrasado, nenhuma NF a pagar e nenhum produto a repor.</div>`
            : '';
        return;
    }
    el.innerHTML = `<span class="atencao-titulo">${ico('bell')} Precisa de atenção</span>` + itens.map(i => `
        <a class="atencao-item ${i.cls}" href="${i.href}">${ico(i.icone)}<span>${i.texto}</span>${ico('arrow-right', 'ico ico-seta')}</a>`).join('');
}

function renderGraficos(stats, empenhos, evolucao) {
    const sp = stats.status_pedidos || {};
    graficoRosca(document.getElementById('chartStatus'), [
        { label: 'Em aberto', value: sp.INCLUIDO || 0, color: 'var(--info)' },
        { label: 'Parcial', value: sp.PARCIAL || 0, color: 'var(--amber)' },
        { label: 'Recebido', value: sp.RECEBIDO || 0, color: 'var(--green)' },
        { label: 'Encerrado', value: sp.ENCERRADO || 0, color: 'var(--slate)' },
    ], 'pedidos');

    // Atrasados entram no mesmo card dos pedidos (só ocupam espaço quando existem)
    const atr = stats.lista_atrasados || [];
    const elA = document.getElementById('chartAtrasados');
    if (!atr.length) {
        elA.innerHTML = stats.pedidos ? `<p class="atraso-ok">${ico('circle-check')} Nenhuma entrega vencida.</p>` : '';
    } else {
        elA.innerHTML = `<div class="mini-titulo text-red">${ico('alarm')} Entregas vencidas</div>`;
        const box = document.createElement('div');
        elA.appendChild(box);
        listaAtrasados(box, atr.slice(0, 4), stats.pedidos_atrasados || 0);
    }

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
}

/** Produtos a repor: abaixo do mínimo primeiro, depois os de menor cobertura. */
function renderRepor(est) {
    const el = document.getElementById('listaRepor');
    if (!est) { el.innerHTML = graficoVazio('Estoque indisponível no momento.'); return; }
    if (!est.produtos.length) {
        el.innerHTML = `<div class="chart-empty">${ico('link', 'ico ico-empty')}Ligue os itens de empenho aos produtos para acompanhar o estoque.
            <a href="/estoque#vinculos" class="btn btn-sm btn-primary">Ligar itens</a></div>`;
        return;
    }
    const lista = est.produtos.filter(p => p.situacao === 'CRITICO' || p.situacao === 'PEDIR')
        .sort((a, b) => (a.situacao === 'CRITICO' ? 0 : 1) - (b.situacao === 'CRITICO' ? 0 : 1) || (a.cobertura_dias ?? 0) - (b.cobertura_dias ?? 0));
    if (!lista.length) {
        const semConsumo = est.produtos.every(p => p.situacao === 'SEM_CONSUMO');
        el.innerHTML = semConsumo
            ? `<div class="chart-empty">${ico('package-export', 'ico ico-empty')}Lance as saídas (consumo) para o sistema calcular quando pedir.
                <a href="/estoque" class="btn btn-sm btn-secondary">Ir para o estoque</a></div>`
            : `<div class="chart-empty ok">${ico('circle-check', 'ico ico-empty')}Nenhum produto precisa ser pedido agora.</div>`;
        return;
    }
    const q = (v) => fmtNum(Math.round(v * 10) / 10);
    el.innerHTML = `<ul class="repor">${lista.slice(0, 5).map(p => {
        const fim = Math.max(p.ponto_pedido, p.saldo, 1);
        const larg = Math.max(0, Math.min(100, p.saldo / fim * 100));
        const critico = p.situacao === 'CRITICO';
        return `<li><a href="/estoque?produto=${p.id}" title="${escapeHTML(p.nome)}: saldo ${q(p.saldo)} ${escapeHTML(p.und)} · ponto de pedido ${q(p.ponto_pedido)} · lote econômico ${p.lec ? Math.ceil(p.lec) : '—'}">
            <div class="repor-top"><span class="repor-nome"><span class="abc abc-${p.classe.toLowerCase()}">${p.classe}</span>${escapeHTML(p.nome)}</span>
                <span class="badge ${critico ? 'critico' : 'atencao'}">${critico ? 'Abaixo do mínimo' : 'Pedir agora'}</span></div>
            <div class="bar repor-bar"><span style="width:${larg}%;background:${critico ? 'var(--red)' : 'var(--amber)'}"></span></div>
            <div class="rank-sub">Saldo ${q(p.saldo)} ${escapeHTML(p.und)} · pedir ${p.lec ? fmtNum(Math.ceil(p.lec)) : '—'} ${escapeHTML(p.und)} · ${p.cobertura_dias === null ? '—' : `${fmtNum(Math.max(0, Math.round(p.cobertura_dias)))} dia(s) de cobertura`}</div>
        </a></li>`;
    }).join('')}</ul>${lista.length > 5 ? `<p class="muted small"><a href="/estoque?situacao=PEDIR">+ ${lista.length - 5} outro(s) no estoque</a></p>` : ''}`;
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    const rodape = document.getElementById('tableRodape');
    const comSaldo = estadoDash.empenhos.filter(e => e.a_liquidar > 0.005);
    const ordenados = ordenar(comSaldo, estadoDash.sort.key, estadoDash.sort.dir);
    const mostrar = estadoDash.verTodos ? ordenados : ordenados.slice(0, estadoDash.limite);
    document.getElementById('countBadge').textContent =
        `${fmtNum(comSaldo.length)} de ${fmtNum(estadoDash.empenhos.length)} empenho${estadoDash.empenhos.length === 1 ? '' : 's'}`;

    if (!estadoDash.empenhos.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty">
            <span class="empty-icon">${ico('inbox', 'ico ico-empty')}</span>
            Nenhum empenho${estadoDash.ano ? ` em ${escapeHTML(estadoDash.ano)}` : ' cadastrado'}.
        </td></tr>`;
        rodape.hidden = true;
        return;
    }
    if (!comSaldo.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty"><span class="empty-icon">${ico('circle-check', 'ico ico-empty')}</span>Todos os empenhos estão liquidados.</td></tr>`;
        rodape.hidden = true;
        return;
    }
    tbody.innerHTML = mostrar.map(e => `
        <tr>
            <td class="text-left nowrap"><strong>${escapeHTML(e.ne)}</strong>
                ${e.pedidos_atrasados ? `<span class="badge critico" title="Pedidos com entrega vencida">${ico('alarm')} ${e.pedidos_atrasados}</span>` : ''}</td>
            <td class="text-left td-forn" title="${escapeHTML(e.nome_credor)}">${escapeHTML(e.nome_credor)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money text-teal">${fmtMoney(e.valor_liquidado)}</td>
            <td class="num money text-green">${fmtMoney(e.valor_pago)}</td>
            <td class="num money text-red"><strong>${fmtMoney(e.a_liquidar)}</strong></td>
            <td>${pctCell(e.percentual_liquidado)}</td>
            <td><a href="/empenhos?id=${e.id}" class="btn btn-sm btn-secondary">Abrir</a></td>
        </tr>`).join('');
    const resto = ordenados.length - mostrar.length;
    rodape.hidden = ordenados.length <= estadoDash.limite;
    rodape.innerHTML = resto > 0
        ? `<button class="btn btn-link btn-sm" id="btnVerTodos">Mostrar mais ${fmtNum(resto)}</button> <a class="btn btn-link btn-sm" href="/empenhos">Abrir a lista completa ${ico('arrow-right')}</a>`
        : `<button class="btn btn-link btn-sm" id="btnVerTodos">Mostrar só os ${estadoDash.limite} primeiros</button>`;
    const b = document.getElementById('btnVerTodos');
    if (b) b.addEventListener('click', () => { estadoDash.verTodos = !estadoDash.verTodos; renderTable(); });
}

// Curva ABC do estoque (mesmo gráfico da tela de Estoque)
function renderAbcDash() {
    const el = document.getElementById('chartAbcDash'), res = document.getElementById('abcDashResumo');
    if (!abcDash) { el.innerHTML = graficoVazio('Curva ABC indisponível no momento.'); res.innerHTML = ''; return; }
    const ps = abcDash.produtos.filter(p => p.valor_anual > 0).sort((a, b) => b.valor_anual - a.valor_anual);
    if (!ps.length) {
        el.innerHTML = graficoVazio(abcDash.produtos.length
            ? 'Lance as saídas (consumo) no Estoque para montar a curva ABC.'
            : 'Ligue os itens de empenho aos produtos no Estoque para montar a curva ABC.');
        res.innerHTML = '';
        return;
    }
    graficoPareto(el, ps, abcDash.config, (id) => { location.href = `/estoque?produto=${id}#abc`; });
    const total = ps.reduce((a, p) => a + p.valor_anual, 0);
    const nTot = abcDash.produtos.length;
    res.innerHTML = ['A', 'B', 'C'].map(c => {
        const g = abcDash.produtos.filter(p => p.classe === c);
        const v = g.reduce((a, p) => a + p.valor_anual, 0);
        return `<a class="abc-dash-linha" href="/estoque#abc">
            <span class="abc abc-${c.toLowerCase()}">${c}</span>
            <span><strong>${pct(total ? v / total * 100 : 0)}</strong> do valor
                <small>${fmtNum(g.length)} produto${g.length === 1 ? '' : 's'} (${pct(nTot ? g.length / nTot * 100 : 0)}) · ${fmtMoneyCurto(v)}/ano</small></span></a>`;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    estadoDash.ano = lerAnoSalvo();
    ativarOrdenacao(document.getElementById('dataTable'), estadoDash.sort, renderTable);
    document.getElementById('btnRefresh').addEventListener('click', () => loadAll({ aviso: true }));
    document.getElementById('btnTentar').addEventListener('click', () => loadAll({ aviso: true }));
    document.getElementById('fExercicio').addEventListener('change', (e) => {
        estadoDash.ano = e.target.value;
        salvarAno(estadoDash.ano);
        estadoDash.verTodos = false;
        loadAll();
    });
    window.addEventListener('resize', () => { clearTimeout(renderAbcDash.t); renderAbcDash.t = setTimeout(renderAbcDash, 200); });
    loadAll();
});
