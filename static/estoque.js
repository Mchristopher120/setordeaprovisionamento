// Estoque: curva ABC, lote econômico (LEC), estoque de segurança (ES) e ponto de pedido (PP).
// As contas são feitas no servidor (estoque.py); aqui só mostramos e lançamos.
const $ = (id) => document.getElementById(id);
const E = { dados: null, vinc: null, vincAlterados: new Map(), sort: { key: 'classe', dir: 1 }, detalhe: null, editando: null };

const SITUACAO = {
    CRITICO: ['Abaixo do mínimo', 'critico', 'Saldo abaixo do estoque de segurança: pedir com urgência'],
    PEDIR: ['Pedir agora', 'atencao', 'Saldo atingiu o ponto de pedido'],
    OK: ['OK', 'ok', 'Saldo acima do ponto de pedido'],
    SEM_CONSUMO: ['Sem consumo', 'neutro', 'Ainda não há saídas lançadas no período'],
};
const ORDEM_SIT = { CRITICO: 0, PEDIR: 1, OK: 2, SEM_CONSUMO: 3 };
const TIPO_MOV = { ENTRADA: ['Entrada (NF)', 'ok', 'package-import'], SAIDA: ['Saída', 'info', 'package-export'],
    INICIAL: ['Inventário inicial', 'neutro', 'clipboard-check'], AJUSTE: ['Ajuste', 'atencao', 'adjustments'] };

const q = (v, und) => (v === null || v === undefined) ? '—' : `${fmtNum(Math.round(v * 10) / 10)}${und ? ` ${escapeHTML(und)}` : ''}`;
const qInt = (v, und) => (v === null || v === undefined) ? '—' : `${fmtNum(Math.ceil(v - 1e-9))}${und ? ` ${escapeHTML(und)}` : ''}`;
const dias = (v) => (v === null || v === undefined) ? '—' : `${fmtNum(Math.round(v))} dia${Math.round(v) === 1 ? '' : 's'}`;
const num2 = (v, casas = 2) => (v === null || v === undefined) ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 }).format(v);
const classeBadge = (c) => `<span class="abc abc-${c.toLowerCase()}" title="Classe ${c}">${c}</span>`;
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// ------------------------------------------------------------------ carga
async function carregar() {
    if (!E.dados) $('tbodyProdutos').innerHTML = linhaCarregando(9);
    try { E.dados = await fetchJSON('/api/estoque'); }
    catch (err) { showToast(err.message, 'error'); $('tbodyProdutos').innerHTML = `<tr><td colspan="9" class="empty">${escapeHTML(err.message)}</td></tr>`; return; }
    renderKpis();
    renderProdutos();
    renderAbc();
    preencherParametros();
    const n = E.dados.resumo.itens_sem_produto;
    $('vincCount').hidden = !n;
    $('vincCount').textContent = n;
    $('avisoVinculo').hidden = !n;
    $('avisoVinculo').innerHTML = n ? `${ico('link')} <span><strong>${n} ${n > 1 ? 'itens de empenho ainda não estão ligados' : 'item de empenho ainda não está ligado'}</strong> a um produto do estoque. As NFs desses itens não entram no saldo.</span>
        <button class="btn btn-sm btn-primary" onclick="trocarAba('vinculos')">Ligar itens</button>` : '';
}

function renderKpis() {
    const r = E.dados.resumo, ps = E.dados.produtos;
    const valorA = ps.filter(p => p.classe === 'A').reduce((a, p) => a + p.valor_anual, 0);
    const pctA = r.valor_anual ? valorA / r.valor_anual * 100 : 0;
    $('kpis').innerHTML = `
        <div class="kpi accent"><div class="kpi-label">Produtos</div><div class="kpi-value">${fmtNum(r.produtos)}</div>
            <div class="kpi-sub">${r.sem_consumo ? `${fmtNum(r.sem_consumo)} sem consumo lançado` : 'todos com consumo'}</div></div>
        <div class="kpi slate"><div class="kpi-label">Valor em estoque</div><div class="kpi-value">${fmtMoney(r.valor_estoque)}</div>
            <div class="kpi-sub">Consumo anual ${fmtMoneyCurto(r.valor_anual)}</div></div>
        <a class="kpi amber kpi-link" href="#" data-filtro="PEDIR"><div class="kpi-label">Pedir agora</div><div class="kpi-value">${fmtNum(r.pedir)}</div>
            <div class="kpi-sub">no ponto de pedido</div></a>
        <a class="kpi red kpi-link" href="#" data-filtro="CRITICO"><div class="kpi-label">Abaixo do mínimo</div><div class="kpi-value">${fmtNum(r.criticos)}</div>
            <div class="kpi-sub">abaixo do estoque de segurança</div></a>
        <a class="kpi teal kpi-link" href="#" data-aba="abc"><div class="kpi-label">Curva ABC</div>
            <div class="kpi-value kpi-abc">${['A', 'B', 'C'].map(c => `<span><b class="t-${c.toLowerCase()}">${c}</b>${fmtNum(r.classes[c])}</span>`).join('')}</div>
            <div class="kpi-sub">classe A = ${pct(pctA)} do valor</div></a>`;
    $('kpis').querySelectorAll('[data-filtro]').forEach(a => a.addEventListener('click', (e) => {
        e.preventDefault(); trocarAba('produtos'); $('pSituacao').value = a.dataset.filtro; renderProdutos();
    }));
    $('kpis').querySelectorAll('[data-aba]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); trocarAba(a.dataset.aba); }));
    ajustarValores($('kpis'));
}

// ------------------------------------------------------------------ produtos
function renderProdutos() {
    const busca = normalizar($('pBusca').value.trim()), sit = $('pSituacao').value, cls = $('pClasse').value;
    let lista = E.dados.produtos.filter(p =>
        (!busca || normalizar(`${p.nome} ${p.categoria || ''} ${p.fornecedores.join(' ')} ${p.empenhos.join(' ')}`).includes(busca)) &&
        (!sit || p.situacao === sit) && (!cls || p.classe === cls));
    if (E.sort.key === 'situacao') {
        lista = [...lista].sort((a, b) => (ORDEM_SIT[a.situacao] - ORDEM_SIT[b.situacao]) * E.sort.dir);
    } else if (E.sort.key === 'classe') {
        lista = [...lista].sort((a, b) => (a.classe.localeCompare(b.classe) || b.valor_anual - a.valor_anual) * E.sort.dir);
    } else {
        lista = ordenar(lista, E.sort.key, E.sort.dir);
    }
    $('tbodyProdutos').innerHTML = lista.length ? lista.map(p => {
        const [rot, cl, dica] = SITUACAO[p.situacao];
        const neg = p.saldo < -1e-9;
        return `<tr class="linha-click" tabindex="0" data-id="${p.id}">
            <td>${classeBadge(p.classe)}</td>
            <td class="text-left"><strong>${escapeHTML(p.nome)}</strong> <span class="muted small">${escapeHTML(p.und)}</span>
                <span class="forn-sub">${p.fornecedores.length ? escapeHTML(p.fornecedores.join(', ')) : 'sem item de empenho ligado'}</span></td>
            <td class="nowrap ${neg ? 'text-red' : ''}" ${neg ? 'title="Saldo negativo: falta lançar NF, inventário inicial ou contagem"' : ''}><strong>${q(p.saldo)}</strong></td>
            <td class="nowrap">${p.media_diaria ? q(p.media_diaria) : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${p.cobertura_dias === null ? '<span class="muted">—</span>' : dias(Math.max(0, p.cobertura_dias))}</td>
            <td class="nowrap">${p.media_diaria ? qInt(p.estoque_seguranca) : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${p.media_diaria ? qInt(p.ponto_pedido) : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${p.lec ? `${qInt(p.lec)}${p.lec_limitado_validade ? ` <span class="muted" title="Limitado pela vida útil">${ico('alert-triangle', 'ico ico-xs')}</span>` : ''}` : '<span class="muted">—</span>'}</td>
            <td><span class="badge ${cl}" title="${dica}">${rot}</span></td>
        </tr>`;
    }).join('') : `<tr><td colspan="9" class="empty"><span class="empty-icon">${ico('building-warehouse', 'ico ico-empty')}</span>${E.dados.produtos.length ? 'Nenhum produto com esses filtros.' : 'Nenhum produto ainda. Comece em <a href="#" onclick="trocarAba(\'vinculos\');return false">Ligar itens</a>: o sistema cria os produtos a partir dos itens dos empenhos.'}</td></tr>`;
}

// ------------------------------------------------------------------ curva ABC
function renderAbc() {
    const ps = [...E.dados.produtos].sort((a, b) => b.valor_anual - a.valor_anual);
    const total = ps.reduce((a, p) => a + p.valor_anual, 0);
    const cfg = E.dados.config;
    const RECOM = {
        A: 'Poucos produtos, maior parte do gasto. Controle rigoroso: contagem semanal, prazos acompanhados de perto e pedidos menores e mais frequentes.',
        B: 'Importância intermediária. Contagem quinzenal e revisão mensal dos parâmetros.',
        C: 'Muitos produtos, pouco valor. Controle simples: contagem mensal, pedidos maiores e menos frequentes.',
    };
    $('abcResumo').innerHTML = ['A', 'B', 'C'].map(c => {
        const g = ps.filter(p => p.classe === c);
        const v = g.reduce((a, p) => a + p.valor_anual, 0);
        return `<div class="card abc-card abc-card-${c.toLowerCase()}">
            <div class="abc-card-head">${classeBadge(c)}<div><strong>Classe ${c}</strong>
                <span class="muted small">${c === 'A' ? `até ${num2(cfg.limite_a, 1)}%` : c === 'B' ? `de ${num2(cfg.limite_a, 1)}% a ${num2(cfg.limite_b, 1)}%` : `acima de ${num2(cfg.limite_b, 1)}%`} do valor acumulado</span></div></div>
            <div class="abc-nums"><div><span>${fmtNum(g.length)}</span>produtos (${pct(ps.length ? g.length / ps.length * 100 : 0)})</div>
                <div><span>${pct(total ? v / total * 100 : 0)}</span>do valor (${fmtMoneyCurto(v)}/ano)</div></div>
            <p class="muted small">${RECOM[c]}</p></div>`;
    }).join('');
    const comValor = ps.filter(p => p.valor_anual > 0);
    $('abcCount').textContent = `${comValor.length} com consumo · ${ps.length - comValor.length} sem consumo (classe C)`;
    $('tbodyAbc').innerHTML = ps.length ? ps.map((p, i) => `<tr class="linha-click" tabindex="0" data-id="${p.id}">
        <td>${i + 1}</td><td class="text-left"><strong>${escapeHTML(p.nome)}</strong> <span class="muted small">${escapeHTML(p.und)}</span></td>
        <td>${classeBadge(p.classe)}</td><td class="nowrap">${p.demanda_anual ? q(p.demanda_anual, p.und) : '—'}</td>
        <td class="nowrap">${fmtMoney(p.custo_unitario)}</td><td class="nowrap"><strong>${fmtMoney(p.valor_anual)}</strong></td>
        <td>${pct(p.participacao)}</td><td>${pct(p.acumulado)}</td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">Sem produtos.</td></tr>`;
    E.paretoDados = [comValor, cfg];
    if (!$('tab-abc').hidden) graficoPareto($('chartAbc'), comValor, cfg, abrirDetalhe);
}

// ------------------------------------------------------------------ detalhe
async function abrirDetalhe(id) {
    let d;
    try { d = await fetchJSON(`/api/estoque/produtos/${id}`); } catch (err) { showToast(err.message, 'error'); return; }
    E.detalhe = d;
    const p = d.produto, cfg = d.config;
    const [rot, cl] = SITUACAO[p.situacao];
    $('detTitulo').innerHTML = `${classeBadge(p.classe)} ${escapeHTML(p.nome)} <span class="muted">(${escapeHTML(p.und)})</span> <span class="badge ${cl}">${rot}</span>`;
    const und = p.und;
    const semConsumo = !p.media_diaria;
    const fonteL = p.origem === 'historico' ? `média de ${p.entregas} entrega${p.entregas > 1 ? 's' : ''} reais (pedido → NF)`
        : p.origem === 'manual' ? 'informado no produto' : 'prazo padrão (ainda sem entregas com data de pedido)';
    const sugestao = p.lec ? Math.ceil(p.lec) : null;
    const compra = !sugestao ? '' : p.saldo_empenho + 1e-9 >= sugestao
        ? `<div class="det-compra ok">${ico('circle-check')} <span>Sugestão de compra: <strong>${fmtNum(sugestao)} ${escapeHTML(und)}</strong> (lote econômico). Há <strong>${q(p.saldo_empenho, und)}</strong> de saldo a pedir nos empenhos.</span></div>`
        : `<div class="det-compra aviso">${ico('alert-triangle')} <span>Sugestão de compra: <strong>${fmtNum(sugestao)} ${escapeHTML(und)}</strong>, mas o saldo a pedir nos empenhos é <strong>${q(p.saldo_empenho, und)}</strong>${p.saldo_empenho > 0 ? ': dá para pedir o saldo e já providenciar novo empenho' : ': é preciso um novo empenho'}.</span></div>`;
    const linhas = [
        ['Consumo médio diário (d̄)', semConsumo ? 'sem saídas no período' : `${num2(p.total, 1)} ${und} ÷ ${p.dias} dias = <strong>${num2(p.media_diaria, 2)} ${und}/dia</strong>`, `desde ${dataBR(p.inicio)}`],
        ['Variação do consumo (σd)', p.desvio_diario === null ? 'precisa de 2 semanas de lançamentos (usado 0)' : `<strong>${num2(p.desvio_diario, 2)} ${und}/dia</strong>`, `${p.semanas} semana(s) analisada(s)`],
        ['Demanda anual (D)', `d̄ × 365 = <strong>${num2(p.demanda_anual, 1)} ${und}</strong>`, ''],
        ['Custo unitário (C)', `<strong>${fmtMoney(p.custo_unitario)}</strong>`, 'item de empenho mais recente'],
        ['Prazo de entrega (L)', `<strong>${num2(p.prazo, 1)} dias</strong>${p.desvio_prazo ? ` · σL = ${num2(p.desvio_prazo, 1)} dia(s)` : ''}`, fonteL],
        ['Nível de serviço', `${num2(p.nivel_servico, 2)}% → Z = <strong>${num2(p.z, 3)}</strong>`, ''],
        ['Valor anual (ABC)', `D × C = <strong>${fmtMoney(p.valor_anual)}</strong>`, `${pct(p.participacao)} do total · acumulado ${pct(p.acumulado)} → classe ${p.classe}`],
        ['Lote econômico (LEC)', p.lec ? `√(2 × ${num2(p.demanda_anual, 1)} × ${fmtMoney(p.custo_pedido)} ÷ (${num2(p.taxa_manutencao, 1)}% × ${fmtMoney(p.custo_unitario)})) = <strong>${num2(p.lec, 1)} ${und}</strong>${p.lec_limitado_validade ? ` (limitado à vida útil de ${p.vida_util_dias} dias)` : ''}` : '—',
            p.lec ? `≈ ${num2(p.pedidos_por_ano, 1)} pedidos/ano, um a cada ${dias(p.intervalo_dias)}` : ''],
        ['Estoque de segurança (ES)', semConsumo ? '—' : `${num2(p.z, 3)} × √(${num2(p.prazo, 1)} × ${num2(p.desvio_diario || 0, 2)}² + ${num2(p.media_diaria, 2)}² × ${num2(p.desvio_prazo, 1)}²) = <strong>${num2(p.estoque_seguranca, 1)} ${und}</strong>`, ''],
        ['Ponto de pedido (PP)', semConsumo ? '—' : `${num2(p.media_diaria, 2)} × ${num2(p.prazo, 1)} + ${num2(p.estoque_seguranca, 1)} = <strong>${num2(p.ponto_pedido, 1)} ${und}</strong>`, ''],
    ];
    const movs = d.movimentos;
    $('detCorpo').innerHTML = `
        <div class="det-nums">
            <div><span>Saldo</span><strong class="${p.saldo < 0 ? 'text-red' : ''}">${q(p.saldo, und)}</strong><small>${dias(p.cobertura_dias === null ? null : Math.max(0, p.cobertura_dias))} de cobertura</small></div>
            <div><span>Estoque de segurança</span><strong>${semConsumo ? '—' : qInt(p.estoque_seguranca, und)}</strong><small>mínimo</small></div>
            <div><span>Ponto de pedido</span><strong>${semConsumo ? '—' : qInt(p.ponto_pedido, und)}</strong><small>pedir ao chegar aqui</small></div>
            <div><span>Lote econômico</span><strong>${p.lec ? qInt(p.lec, und) : '—'}</strong><small>quanto pedir</small></div>
        </div>
        ${compra}
        ${p.und_divergente.length ? `<div class="det-compra aviso">${ico('alert-triangle')} <span>Atenção: há itens ligados com outra unidade (${escapeHTML(p.und_divergente.join(', '))}). As quantidades das NFs entram como estão.</span></div>` : ''}
        <details class="det-calc" open><summary>${ico('math-function')} Como foi calculado</summary>
            <table class="calc"><tbody>${linhas.map(([a, b, c]) => `<tr><th>${a}</th><td>${b}</td><td class="muted small">${c}</td></tr>`).join('')}</tbody></table>
            <p class="muted small">Saldo = inicial ${q(p.inicial)} + NFs ${q(p.entradas)} − saídas ${q(p.saidas)} ${p.ajustes < 0 ? '−' : '+'} ajustes ${q(Math.abs(p.ajustes))} = ${q(p.saldo, und)}.</p>
        </details>
        <details class="det-calc"><summary>${ico('receipt')} Itens de empenho ligados (${d.itens.length})</summary>
            ${d.itens.length ? `<div class="table-wrap"><table><thead><tr><th>NE</th><th class="text-left">Fornecedor</th><th>Item</th><th>Und</th><th>Valor unit.</th><th>Recebido</th><th>Saldo a pedir</th></tr></thead><tbody>
            ${d.itens.map(i => `<tr><td><a href="/empenhos?id=${i.empenho_id}">${escapeHTML(i.ne)}</a></td><td class="text-left">${escapeHTML(i.fornecedor)}</td>
                <td>${escapeHTML(i.numero_item)}</td><td>${escapeHTML(i.und)}</td><td>${fmtMoney(i.valor_unitario)}</td><td>${q(i.qtde_recebida)}</td><td><strong>${q(i.saldo_a_pedir)}</strong></td></tr>`).join('')}
            </tbody></table></div>` : '<p class="muted small">Nenhum. Ligue em “Ligar itens” para as NFs entrarem no estoque.</p>'}
        </details>
        <details class="det-calc" ${movs.length ? '' : 'open'}><summary>${ico('history')} Lançamentos (${movs.length})</summary>
            ${movs.length ? `<div class="table-wrap det-movs"><table><thead><tr><th>Data</th><th>Tipo</th><th>Quantidade</th><th class="text-left">Detalhe</th><th></th></tr></thead><tbody>
            ${movs.map(m => { const [r, c, i] = TIPO_MOV[m.tipo] || [m.tipo, 'neutro', 'history'];
                const sinal = m.tipo === 'SAIDA' ? -m.qtde : m.qtde;
                return `<tr><td class="nowrap">${dataBR(m.data)}</td><td><span class="badge ${c}">${ico(i)} ${r}</span></td>
                <td class="nowrap ${sinal < 0 ? 'text-red' : 'text-green'}">${sinal > 0 ? '+' : sinal < 0 ? '−' : ''}${q(Math.abs(sinal), und)}</td>
                <td class="text-left small">${escapeHTML(m.observacoes || '')}${m.usuario ? ` <span class="muted">· ${escapeHTML(m.usuario)}</span>` : ''}</td>
                <td>${m.origem === 'manual' ? `<button class="btn btn-sm btn-danger" title="Apagar lançamento" aria-label="Apagar lançamento" onclick="apagarMov(${m.id})">${ico('trash')}</button>` : ''}</td></tr>`; }).join('')}
            </tbody></table></div>` : '<p class="muted small">Sem lançamentos. Comece pelo inventário inicial (Contagem) e depois lance as saídas.</p>'}
        </details>`;
    abrir('modalProduto');
}

async function apagarMov(id) {
    if (!confirm('Apagar este lançamento? O saldo e os cálculos serão refeitos.')) return;
    try {
        const r = await enviarJSON(`/api/estoque/movimentos/${id}`, 'DELETE');
        if (!r.ok) { showToast(r.error, 'error'); return; }
        showToast('Lançamento apagado', 'success');
        await carregar();
        abrirDetalhe(E.detalhe.produto.id);
    } catch (err) { showToast(err.message, 'error'); }
}

// ------------------------------------------------------------------ lançamentos
const AJUDA_LANC = {
    SAIDA: 'Informe o que saiu (foi consumido) em cada produto. Deixe em branco o que não teve saída. Pode lançar o dia ou a semana inteira.',
    CONTAGEM: 'Informe o saldo contado na prateleira. O sistema lança a diferença como ajuste (perda, sobra ou erro de lançamento).',
    INICIAL: 'Use uma vez, ao começar o controle: a quantidade que já existia no estoque naquele dia.',
    AJUSTE: 'Correção direta: use número positivo para somar e negativo para tirar (ex.: −3 por perda/validade).',
};
function abrirLancamento(tipo = 'SAIDA', soProduto = null) {
    $('lancTipo').value = tipo;
    $('lancData').value = hojeISO();
    $('lancData').max = hojeISO();
    $('lancObs').value = '';
    $('lancBusca').value = '';
    E.lancSo = soProduto;
    renderLancamento(true);
    abrir('modalLanc');
    setTimeout(() => { const i = $('tbodyLanc').querySelector('input'); if (i) i.focus(); }, 40);
}
function renderLancamento(limpar = false) {
    const tipo = $('lancTipo').value;
    const titulos = { SAIDA: 'Lançar saídas', CONTAGEM: 'Contagem de estoque', INICIAL: 'Inventário inicial', AJUSTE: 'Ajuste de estoque' };
    $('lancTitulo').textContent = titulos[tipo];
    $('lancAjuda').textContent = AJUDA_LANC[tipo];
    $('lancColQtd').textContent = tipo === 'CONTAGEM' ? 'Saldo contado' : tipo === 'AJUSTE' ? 'Ajuste (±)' : 'Quantidade';
    const valores = {};
    if (!limpar) $('tbodyLanc').querySelectorAll('input').forEach(i => { valores[i.dataset.id] = i.value; });
    const busca = normalizar($('lancBusca').value.trim());
    const ps = E.dados.produtos.filter(p => (!E.lancSo || p.id === E.lancSo) && (!busca || normalizar(p.nome).includes(busca)))
        .sort((a, b) => a.classe.localeCompare(b.classe) || a.nome.localeCompare(b.nome, 'pt-BR'));
    $('tbodyLanc').innerHTML = ps.length ? ps.map(p => `<tr>
        <td class="text-left">${classeBadge(p.classe)} <strong>${escapeHTML(p.nome)}</strong> <span class="muted small">${escapeHTML(p.und)}</span></td>
        <td class="nowrap ${p.saldo < 0 ? 'text-red' : 'muted'}">${q(p.saldo, p.und)}</td>
        <td><input class="lanc-qtd" data-id="${p.id}" inputmode="decimal" value="${escapeHTML(valores[p.id] || '')}" placeholder="${tipo === 'CONTAGEM' ? fmtNum(Math.round(Math.max(0, p.saldo) * 10) / 10) : '0'}" aria-label="Quantidade de ${escapeHTML(p.nome)}"></td></tr>`).join('')
        : `<tr><td colspan="3" class="empty">Nenhum produto. Crie-os em “Ligar itens”.</td></tr>`;
    $('tbodyLanc').querySelectorAll('input').forEach(i => i.addEventListener('input', resumoLanc));
    resumoLanc();
}
function resumoLanc() {
    const n = [...$('tbodyLanc').querySelectorAll('input')].filter(i => i.value.trim()).length;
    $('lancResumo').textContent = n ? `${n} produto(s) preenchido(s)` : '';
    $('btnLancar').disabled = !n;
}
async function lancar() {
    const tipo = $('lancTipo').value;
    const itens = [...$('tbodyLanc').querySelectorAll('input')].filter(i => i.value.trim())
        .map(i => ({ produto_id: +i.dataset.id, qtde: parseNumBR(i.value) }));
    if (itens.some(x => x.qtde === null || Number.isNaN(x.qtde))) { showToast('Há quantidade inválida', 'error'); return; }
    const b = $('btnLancar'); b.disabled = true;
    try {
        const r = await enviarJSON('/api/estoque/movimentos', 'POST', { tipo, data: $('lancData').value, observacoes: $('lancObs').value.trim(), itens });
        if (!r.ok) { showToast(r.error, 'error'); return; }
        fechar('modalLanc');
        showToast(r.avisos && r.avisos.length ? r.avisos.join(' ') : `${r.lancados} lançamento(s) feito(s)`, r.avisos && r.avisos.length ? '' : 'success');
        await carregar();
        if (E.lancSo && $('modalProduto').style.display === 'flex') abrirDetalhe(E.lancSo);
    } catch (err) { showToast(err.message, 'error'); }
    finally { b.disabled = false; }
}

// ------------------------------------------------------------------ cadastro
function abrirForm(p = null) {
    E.editando = p;
    $('formTitulo').textContent = p ? `Editar ${p.nome}` : 'Novo produto';
    const cfg = E.dados.config;
    const v = (x) => (x === null || x === undefined) ? '' : String(x).replace('.', ',');
    $('fNome').value = p ? p.nome : ''; $('fUnd').value = p ? p.und : '';
    $('fCategoria').value = p ? (p.categoria || '') : ''; $('fVida').value = p ? v(p.vida_util_dias) : '';
    $('fPrazo').value = p ? v(p.prazo_dias) : ''; $('fNs').value = p ? v(p.nivel_servico) : '';
    $('fS').value = p ? v(p.custo_pedido) : ''; $('fI').value = p ? v(p.taxa_manutencao) : '';
    $('fObs').value = p ? (p.observacoes || '') : '';
    $('fPrazo').placeholder = p && p.origem === 'historico' ? `Real: ${num2(p.prazo, 1)} dias` : `Padrão: ${num2(cfg.prazo_padrao_dias, 0)} dias`;
    $('fNs').placeholder = `Padrão: ${num2(cfg.nivel_servico)}%`;
    $('fS').placeholder = `Padrão: ${fmtMoney(cfg.custo_pedido)}`;
    $('fI').placeholder = `Padrão: ${num2(cfg.taxa_manutencao)}%`;
    $('listaCategorias').innerHTML = [...new Set(E.dados.produtos.map(x => x.categoria).filter(Boolean))].map(c => `<option value="${escapeHTML(c)}">`).join('');
    abrir('modalForm');
    setTimeout(() => $('fNome').focus(), 30);
}
async function salvarProduto() {
    const corpo = { nome: $('fNome').value.trim(), und: $('fUnd').value.trim(), categoria: $('fCategoria').value.trim(),
        vida_util_dias: $('fVida').value.trim(), prazo_dias: $('fPrazo').value.trim(), nivel_servico: $('fNs').value.trim(),
        custo_pedido: $('fS').value.trim(), taxa_manutencao: $('fI').value.trim(), observacoes: $('fObs').value.trim() };
    const p = E.editando;
    try {
        const r = p ? await enviarJSON(`/api/estoque/produtos/${p.id}`, 'PUT', corpo) : await enviarJSON('/api/estoque/produtos', 'POST', corpo);
        if (!r.ok) { showToast(r.error, 'error'); return; }
        fechar('modalForm');
        showToast('Produto salvo', 'success');
        await carregar();
        if (p && $('modalProduto').style.display === 'flex') abrirDetalhe(p.id);
    } catch (err) { showToast(err.message, 'error'); }
}
async function apagarProduto() {
    const p = E.detalhe.produto;
    if (!confirm(`Apagar o produto ${p.nome}?\n\nOs lançamentos de estoque dele vão para a Lixeira e os itens de empenho ficam sem produto. Os empenhos e NFs não mudam.`)) return;
    try {
        const r = await enviarJSON(`/api/estoque/produtos/${p.id}`, 'DELETE');
        if (!r.ok) { showToast(r.error, 'error'); return; }
        fechar('modalProduto'); showToast('Produto enviado para a lixeira', 'success');
        E.vinc = null; await carregar();
    } catch (err) { showToast(err.message, 'error'); }
}

// ------------------------------------------------------------------ ligar itens
async function carregarVinculos() {
    $('tbodyVinc').innerHTML = linhaCarregando(5);
    try { E.vinc = await fetchJSON('/api/estoque/vinculos'); } catch (err) { showToast(err.message, 'error'); return; }
    E.vincAlterados.clear();
    renderVinculos();
}
function opcoesProduto(it) {
    const atual = E.vincAlterados.has(it.id) ? E.vincAlterados.get(it.id) : (it.produto_id ? String(it.produto_id) : '');
    const novoVal = `novo:${it.sugestao_nome}|${it.sugestao_und}`;
    const temSug = it.sugestao_produto_id;
    return `<select class="vinc-sel" data-id="${it.id}" aria-label="Produto do item ${escapeHTML(it.numero_item)}">
        <option value="">— sem produto —</option>
        ${!temSug ? `<option value="${escapeHTML(novoVal)}" ${atual === novoVal ? 'selected' : ''}>+ Criar “${escapeHTML(it.sugestao_nome)}” (${escapeHTML(it.sugestao_und)})</option>` : ''}
        ${E.vinc.produtos.map(p => `<option value="${p.id}" ${atual === String(p.id) ? 'selected' : ''}>${escapeHTML(p.nome)} (${escapeHTML(p.und)})${p.id === temSug && !it.produto_id ? ' — sugerido' : ''}</option>`).join('')}
    </select>`;
}
function renderVinculos() {
    if (!E.vinc) return;
    const busca = normalizar($('vBusca').value.trim()), soSem = $('vSoSem').checked;
    const lista = E.vinc.itens.filter(i => (!soSem || !i.produto_id || E.vincAlterados.has(i.id)) &&
        (!busca || normalizar(`${i.ne} ${i.numero_item} ${i.descricao} ${i.nome_credor}`).includes(busca)));
    $('tbodyVinc').innerHTML = lista.length ? lista.map(i => `<tr class="${E.vincAlterados.has(i.id) ? 'vinc-mudou' : ''}">
        <td class="nowrap">${escapeHTML(i.ne)}<span class="forn-sub">${escapeHTML(i.nome_credor)}</span></td><td>${escapeHTML(i.numero_item)}</td>
        <td class="text-left small" title="${escapeHTML(i.descricao)}">${escapeHTML((i.descricao || '').length > 90 ? i.descricao.slice(0, 88) + '…' : i.descricao)}</td>
        <td>${escapeHTML(i.und)}</td><td class="text-left">${opcoesProduto(i)}</td></tr>`).join('')
        : `<tr><td colspan="5" class="empty">${soSem ? 'Todos os itens já estão ligados a um produto. ' : ''}Nada para mostrar.</td></tr>`;
    $('tbodyVinc').querySelectorAll('.vinc-sel').forEach(s => s.addEventListener('change', () => {
        const it = E.vinc.itens.find(x => x.id === +s.dataset.id);
        const orig = it.produto_id ? String(it.produto_id) : '';
        if (s.value === orig) E.vincAlterados.delete(it.id); else E.vincAlterados.set(it.id, s.value);
        s.closest('tr').classList.toggle('vinc-mudou', E.vincAlterados.has(it.id));
        $('btnSalvarVinc').disabled = !E.vincAlterados.size;
    }));
    $('btnSalvarVinc').disabled = !E.vincAlterados.size;
    $('btnSalvarVinc').innerHTML = `${ico('device-floppy')} Salvar${E.vincAlterados.size ? ` (${E.vincAlterados.size})` : ''}`;
}
function aceitarSugestoes() {
    let n = 0;
    E.vinc.itens.filter(i => !i.produto_id).forEach(i => {
        E.vincAlterados.set(i.id, i.sugestao_produto_id ? String(i.sugestao_produto_id) : `novo:${i.sugestao_nome}|${i.sugestao_und}`);
        n++;
    });
    renderVinculos();
    showToast(n ? `${n} sugestão(ões) marcada(s). Confira e clique em Salvar.` : 'Não há itens sem produto.', n ? 'success' : '');
}
async function salvarVinculos() {
    const vinculos = [...E.vincAlterados.entries()].map(([item_id, v]) => {
        if (v.startsWith('novo:')) { const [nome, und] = v.slice(5).split('|'); return { item_id, novo: { nome, und } }; }
        return { item_id, produto_id: v ? +v : null };
    });
    const b = $('btnSalvarVinc'); b.disabled = true;
    try {
        const r = await enviarJSON('/api/estoque/vinculos', 'POST', { vinculos });
        if (!r.ok) { showToast(r.error, 'error'); b.disabled = false; return; }
        showToast(`${r.ligados} item(ns) ligado(s)${r.produtos_criados ? `, ${r.produtos_criados} produto(s) criado(s)` : ''}`, 'success');
        await Promise.all([carregar(), carregarVinculos()]);
    } catch (err) { showToast(err.message, 'error'); b.disabled = false; }
}

// ------------------------------------------------------------------ parâmetros
function preencherParametros() {
    const cfg = E.dados.config;
    ['custo_pedido', 'taxa_manutencao', 'nivel_servico', 'periodo_dias', 'prazo_padrao_dias', 'limite_a', 'limite_b'].forEach(k => {
        const el = $(`cfg_${k}`); if (document.activeElement !== el) el.value = String(cfg[k]).replace('.', ',');
    });
}
async function salvarParametros(e) {
    e.preventDefault();
    const corpo = {};
    ['custo_pedido', 'taxa_manutencao', 'nivel_servico', 'periodo_dias', 'prazo_padrao_dias', 'limite_a', 'limite_b'].forEach(k => { corpo[k] = $(`cfg_${k}`).value.trim(); });
    try {
        const r = await enviarJSON('/api/estoque/config', 'PUT', corpo);
        if (!r.ok) { showToast(r.error, 'error'); return; }
        showToast('Parâmetros salvos e cálculos refeitos', 'success');
        await carregar();
    } catch (err) { showToast(err.message, 'error'); }
}

// ------------------------------------------------------------------ infraestrutura
function abrir(id) { $(id).style.display = 'flex'; }
function fechar(id) { $(id).style.display = 'none'; }
function trocarAba(nome) {
    document.querySelectorAll('.tab').forEach(t => { const a = t.dataset.tab === nome; t.classList.toggle('active', a); t.setAttribute('aria-selected', a); });
    ['produtos', 'abc', 'vinculos', 'param'].forEach(n => { $(`tab-${n}`).hidden = n !== nome; });
    if (nome === 'vinculos' && !E.vinc) carregarVinculos();
    if (nome === 'abc' && E.paretoDados) graficoPareto($('chartAbc'), ...E.paretoDados, abrirDetalhe); // largura certa só com a aba visível
    history.replaceState(null, '', nome === 'produtos' ? location.pathname : `#${nome}`);
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => trocarAba(t.dataset.tab)));
    ['pBusca', 'pSituacao', 'pClasse'].forEach(id => $(id).addEventListener('input', renderProdutos));
    ['vBusca', 'vSoSem'].forEach(id => $(id).addEventListener('input', renderVinculos));
    $('lancTipo').addEventListener('change', () => renderLancamento(false));
    $('lancBusca').addEventListener('input', () => renderLancamento(false));
    $('btnLancar').addEventListener('click', lancar);
    $('btnSaidas').addEventListener('click', () => abrirLancamento('SAIDA'));
    $('btnContagem').addEventListener('click', () => abrirLancamento(E.dados && E.dados.produtos.some(p => p.inicial || p.saidas) ? 'CONTAGEM' : 'INICIAL'));
    $('btnNovoProduto').addEventListener('click', () => abrirForm());
    $('btnSalvarProduto').addEventListener('click', salvarProduto);
    $('btnSugestoes').addEventListener('click', aceitarSugestoes);
    $('btnSalvarVinc').addEventListener('click', salvarVinculos);
    $('formParam').addEventListener('submit', salvarParametros);
    $('detEditar').addEventListener('click', () => abrirForm(E.detalhe.produto));
    $('detSaida').addEventListener('click', () => abrirLancamento('SAIDA', E.detalhe.produto.id));
    $('detContar').addEventListener('click', () => abrirLancamento('CONTAGEM', E.detalhe.produto.id));
    $('detApagar').addEventListener('click', apagarProduto);
    ['tbodyProdutos', 'tbodyAbc'].forEach(id => {
        $(id).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) abrirDetalhe(+tr.dataset.id); });
        $(id).addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') abrirDetalhe(+tr.dataset.id); });
    });
    // Modais: fecha no X/Cancelar, clicando fora e com Esc (o de cima primeiro)
    const modais = ['modalForm', 'modalLanc', 'modalProduto'];
    modais.forEach(id => {
        $(id).querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => fechar(id)));
        $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) fechar(id); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const aberto = modais.find(id => $(id).style.display === 'flex');
        if (aberto) fechar(aberto);
    });
    $('modalForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') salvarProduto(); });
    ativarOrdenacao($('tblProdutos'), E.sort, renderProdutos);
    const aba = location.hash.slice(1);
    if (['abc', 'vinculos', 'param'].includes(aba)) trocarAba(aba);
    carregar().then(() => {
        // vindo do gráfico do Dashboard: /estoque?produto=ID#abc abre o produto
        const pid = new URLSearchParams(location.search).get('produto');
        if (pid && E.dados && E.dados.produtos.some(p => p.id === +pid)) abrirDetalhe(+pid);
        if (pid) history.replaceState(null, '', location.pathname + location.hash);
    });
    fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => { /* contador é opcional */ });
});
