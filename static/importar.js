// Importação em lote: verifica a planilha (prévia) e só grava quando confirmado.
const $ = (id) => document.getElementById(id);
let arquivoAtual = null;

function escolher(arq) {
    arquivoAtual = arq || null;
    $('nomeArquivo').textContent = arq ? arq.name : 'Escolha a planilha (.xlsx)';
    $('btnVerificar').disabled = !arq;
    $('resultado').hidden = true;
}

async function enviar(confirmar) {
    const fd = new FormData();
    fd.append('arquivo', arquivoAtual);
    if (confirmar) fd.append('confirmar', '1');
    return fetchJSON('/api/importar', { method: 'POST', body: fd });
}

function tabelaResumo(lista) {
    const tot = lista.reduce((a, e) => ({
        itens: a.itens + e.itens, pedidos: a.pedidos + e.pedidos, nfs: a.nfs + e.nfs,
        empenhado: a.empenhado + e.empenhado, liquidado: a.liquidado + e.liquidado, saldo: a.saldo + e.saldo_a_pedir,
    }), { itens: 0, pedidos: 0, nfs: 0, empenhado: 0, liquidado: 0, saldo: 0 });
    return `<div class="table-wrap"><table>
        <thead><tr><th>NE</th><th>Fornecedor</th><th>Processo</th><th>Itens</th><th>Pedidos</th><th>NFs</th>
            <th>Empenhado</th><th>Liquidado</th><th>Saldo a pedir</th></tr></thead>
        <tbody>${lista.map(e => `<tr>
            <td class="nowrap"><strong>${escapeHTML(e.ne)}</strong></td>
            <td class="text-left">${escapeHTML(e.fornecedor)}</td>
            <td>${escapeHTML(e.processo || '—')}</td>
            <td>${e.itens}</td>
            <td>${e.pedidos}${e.em_aberto ? `<div class="muted small">${e.em_aberto} sem entrega</div>` : ''}</td>
            <td>${e.nfs}</td>
            <td class="nowrap">${fmtMoney(e.empenhado)}</td>
            <td class="nowrap">${fmtMoney(e.liquidado)}</td>
            <td class="nowrap">${fmtMoney(e.saldo_a_pedir)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3" class="text-left"><strong>Total (${lista.length} empenhos)</strong></td>
            <td>${tot.itens}</td><td>${tot.pedidos}</td><td>${tot.nfs}</td>
            <td class="nowrap"><strong>${fmtMoney(tot.empenhado)}</strong></td>
            <td class="nowrap"><strong>${fmtMoney(tot.liquidado)}</strong></td>
            <td class="nowrap"><strong>${fmtMoney(tot.saldo)}</strong></td></tr></tfoot>
    </table></div>`;
}

function mostrar(d) {
    const r = $('resultado');
    r.hidden = false;
    const lista = d.empenhos || [];
    let html = '';
    if (d.gravado) {
        html += `<div class="import-msg ok">${ico('circle-check')}<div><strong>Importação concluída.</strong>
            ${lista.length} empenho(s) cadastrado(s). As NFs estão como “a pagar”: marque o pagamento em cada pedido.</div>
            <a href="/empenhos" class="btn btn-primary btn-sm">${ico('receipt')} Ver empenhos</a></div>`;
    } else if (d.erros && d.erros.length) {
        html += `<div class="import-msg erro">${ico('alert-triangle')}<div><strong>Corrija ${d.erros.length} problema(s) na planilha e verifique de novo.</strong>
            Nada foi gravado.<ul class="lista-erros">${d.erros.map(e => `<li>${escapeHTML(e)}</li>`).join('')}</ul></div></div>`;
    } else {
        html += `<div class="import-msg info">${ico('circle-check')}<div><strong>Planilha conferida, sem erros.</strong>
            Confira a prévia abaixo. Nada foi gravado ainda.</div>
            <button type="button" class="btn btn-primary" id="btnImportar">${ico('file-upload')} Importar ${lista.length} empenho(s)</button></div>`;
    }
    if (d.avisos && d.avisos.length) {
        html += `<div class="import-msg aviso">${ico('alert-triangle')}<div><ul class="lista-erros">${d.avisos.map(a => `<li>${escapeHTML(a)}</li>`).join('')}</ul></div></div>`;
    }
    if (lista.length) {
        html += `<div class="card table-card"><div class="table-head"><h3>${d.gravado ? 'Importado' : 'Prévia'}</h3>
            <span class="count-badge">${lista.length} empenhos</span></div>${tabelaResumo(lista)}</div>`;
    }
    r.innerHTML = html;
    const b = $('btnImportar');
    if (b) b.addEventListener('click', async () => {
        if (!confirm(`Importar ${lista.length} empenho(s) com itens, pedidos e NFs?`)) return;
        b.disabled = true;
        b.innerHTML = '<span class="spinner"></span> Importando…';
        try {
            const d2 = await enviar(true);
            mostrar(d2);
            if (d2.gravado) { showToast('Importação concluída!', 'success'); escolherSemLimpar(); }
        } catch (err) { showToast(err.message, 'error'); b.disabled = false; b.textContent = 'Importar'; }
    });
    r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escolherSemLimpar() {
    arquivoAtual = null;
    $('arquivo').value = '';
    $('nomeArquivo').textContent = 'Escolha a planilha (.xlsx)';
    $('btnVerificar').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
    $('arquivo').addEventListener('change', (e) => escolher(e.target.files[0]));
    const dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('arrastando'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('arrastando'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) escolher(e.dataTransfer.files[0]); });
    $('formImport').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!arquivoAtual) return;
        const b = $('btnVerificar');
        b.disabled = true;
        const txt = b.innerHTML;
        b.innerHTML = '<span class="spinner"></span> Verificando…';
        try { mostrar(await enviar(false)); }
        catch (err) { showToast(err.message, 'error'); }
        finally { b.innerHTML = txt; b.disabled = !arquivoAtual; }
    });
    fetchJSON('/api/stats_empenhos').then(marcarPendencias).catch(() => { /* contador é opcional */ });
    iniciarNe();
});

// =====================================================================
// NOTA DE EMPENHO EM PDF — lê (prévia editável) e só grava ao confirmar
// =====================================================================
const NE = { arquivos: [], notas: [] };

function trocarAbaImportar(nome) {
    document.querySelectorAll('.tab').forEach(t => { const a = t.dataset.tab === nome; t.classList.toggle('active', a); t.setAttribute('aria-selected', a); });
    $('tab-pdf').hidden = nome !== 'pdf';
    $('tab-xlsx').hidden = nome !== 'xlsx';
    history.replaceState(null, '', nome === 'xlsx' ? '#planilha' : location.pathname);
}

function escolherNe(lista) {
    NE.arquivos = [...lista].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    const n = NE.arquivos.length;
    $('nomeNe').textContent = !n ? 'Escolha os PDFs das Notas de Empenho' : n === 1 ? NE.arquivos[0].name : `${n} arquivos escolhidos`;
    $('btnLerNe').disabled = !n;
    $('resultadoNe').hidden = true;
    if (lista.length && !n) showToast('Escolha arquivos PDF', 'error');
}

const numCampo = (v, casas = 2) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas, useGrouping: false }).format(v);

function cartaoNota(n, idx) {
    if (!n.ne) {
        return `<div class="card ne-card ne-erro"><div class="ne-cab"><div><strong>${escapeHTML(n.arquivo)}</strong></div><span class="badge critico">Não lido</span></div>
            <ul class="lista-erros">${n.erros.map(e => `<li>${escapeHTML(e)}</li>`).join('')}</ul></div>`;
    }
    const origem = { cadastro: 'Nome do cadastro de fornecedores (mesmo CNPJ).', empenhos: 'Nome igual ao de outros empenhos deste fornecedor.',
        pdf: 'Nome como está na NE (o SIAFI corta em 45 letras). Complete se quiser.' }[n.fornecedor_origem] || '';
    const confere = n.valor !== null && Math.abs(n.soma_itens - n.valor) < 0.011;
    return `<div class="card ne-card${n.ok ? '' : ' ne-erro'}" data-idx="${idx}">
        <div class="ne-cab">
            <label class="check ne-incluir"><input type="checkbox" data-incluir ${n.ok ? 'checked' : 'disabled'}>
                <span><strong class="ne-num">${escapeHTML(n.ne)}</strong><span class="muted small">${escapeHTML(n.arquivo)}</span></span></label>
            <div class="ne-meta">
                ${n.data_emissao ? `<span>Emissão <strong>${dataBR(n.data_emissao)}</strong></span>` : ''}
                ${n.valor !== null ? `<span>Valor <strong>${fmtMoney(n.valor)}</strong></span>` : ''}
                <span class="badge ${confere ? 'ok' : 'atencao'}">${ico(confere ? 'circle-check' : 'alert-triangle')} ${confere ? 'Soma dos itens confere' : 'Confira a soma'}</span>
            </div>
        </div>
        ${n.erros.length ? `<div class="import-msg erro">${ico('alert-triangle')}<div><ul class="lista-erros">${n.erros.map(e => `<li>${escapeHTML(e)}</li>`).join('')}</ul></div></div>` : ''}
        ${n.avisos.length ? `<div class="import-msg aviso">${ico('alert-triangle')}<div><ul class="lista-erros">${n.avisos.map(e => `<li>${escapeHTML(e)}</li>`).join('')}</ul></div></div>` : ''}
        <div class="ne-campos">
            <div class="ne-campo ne-forn"><label for="neForn${idx}">Fornecedor</label>
                <input type="text" id="neForn${idx}" data-forn value="${escapeHTML(n.fornecedor)}" ${n.ok ? '' : 'disabled'}>
                <span class="hint">${n.cnpj ? `CNPJ ${escapeHTML(n.cnpj)} · ` : ''}${origem}</span></div>
            <div class="ne-campo"><label for="neProc${idx}">Processo</label>
                <input type="text" id="neProc${idx}" data-proc value="${escapeHTML(n.processo)}" ${n.ok ? '' : 'disabled'}>
                <span class="hint">${n.nup ? `NUP ${escapeHTML(n.nup)}` : ''}</span></div>
        </div>
        <div class="table-wrap"><table class="ne-tab">
            <thead><tr><th>Item</th><th class="text-left">Descrição</th><th>Unidade</th><th class="num">Quantidade</th><th class="num">Valor unit.</th><th class="num">Total</th></tr></thead>
            <tbody>${n.itens.map((it, k) => `<tr>
                <td>${escapeHTML(it.numero_item)}</td>
                <td class="text-left"><strong>${escapeHTML(it.nome_curto || it.descricao)}</strong>${it.nome_curto ? `<span class="forn-sub">${escapeHTML(it.descricao)}</span>` : ''}</td>
                <td><input type="text" class="ne-und" data-und="${k}" value="${escapeHTML(it.und)}" placeholder="KG" maxlength="20" aria-label="Unidade do item ${escapeHTML(it.numero_item)}" ${n.ok ? '' : 'disabled'}></td>
                <td class="num">${fmtNum(it.qtde)}</td><td class="num">${fmtMoney(it.valor_unitario)}</td><td class="num"><strong>${fmtMoney(it.valor_total)}</strong></td>
            </tr>`).join('')}</tbody>
        </table></div>
    </div>`;
}

function mostrarNotas() {
    const r = $('resultadoNe');
    r.hidden = false;
    const boas = NE.notas.filter(n => n.ok).length;
    r.innerHTML = `
        <div class="ne-barra card">
            <div><strong>${boas} de ${NE.notas.length} nota(s) pronta(s) para cadastrar.</strong>
                <span class="muted small">Nada foi gravado ainda. Confira o fornecedor e preencha a unidade dos itens.</span></div>
            <div class="ne-barra-acoes">
                <label class="ne-und-todos">Unidade para os itens em branco
                    <input type="text" id="neUndTodos" placeholder="KG" maxlength="20"></label>
                <button type="button" class="btn btn-secondary btn-sm" id="btnUndTodos">Aplicar</button>
                <button type="button" class="btn btn-primary" id="btnGravarNe" ${boas ? '' : 'disabled'}>${ico('file-upload')} Cadastrar</button>
            </div>
        </div>
        ${NE.notas.map(cartaoNota).join('')}`;
    const contar = () => {
        const n = r.querySelectorAll('[data-incluir]:checked').length;
        $('btnGravarNe').disabled = !n;
        $('btnGravarNe').innerHTML = `${ico('file-upload')} Cadastrar ${n} empenho${n === 1 ? '' : 's'}`;
    };
    r.querySelectorAll('[data-incluir]').forEach(c => c.addEventListener('change', contar));
    contar();
    $('btnUndTodos').addEventListener('click', () => {
        const u = $('neUndTodos').value.trim().toUpperCase();
        if (!u) { $('neUndTodos').focus(); return; }
        let n = 0;
        r.querySelectorAll('.ne-und:not([disabled])').forEach(i => { if (!i.value.trim()) { i.value = u; n++; } });
        showToast(n ? `Unidade ${u} aplicada em ${n} item(ns)` : 'Não havia item com a unidade em branco', n ? 'success' : '');
    });
    $('btnGravarNe').addEventListener('click', gravarNotas);
    r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function gravarNotas() {
    const r = $('resultadoNe');
    const notas = [];
    let semUnd = 0;
    r.querySelectorAll('.ne-card[data-idx]').forEach(card => {
        if (!card.querySelector('[data-incluir]').checked) return;
        const n = NE.notas[+card.dataset.idx];
        const itens = n.itens.map((it, k) => {
            const und = card.querySelector(`[data-und="${k}"]`).value.trim().toUpperCase();
            if (!und) semUnd++;
            return { numero_item: it.numero_item, descricao: it.descricao, und, qtde: it.qtde, valor_unitario: it.valor_unitario };
        });
        notas.push({ ne: n.ne, processo: card.querySelector('[data-proc]').value.trim(), fornecedor: card.querySelector('[data-forn]').value.trim(), cnpj: n.cnpj, itens });
    });
    if (!notas.length) return;
    if (notas.some(n => !n.fornecedor)) { showToast('Preencha o fornecedor de todas as notas marcadas', 'error'); return; }
    if (semUnd && !confirm(`${semUnd} item(ns) estão sem unidade. Cadastrar assim mesmo?\n\nVocê pode completar depois, em Editar item.`)) return;
    const b = $('btnGravarNe');
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> Cadastrando…';
    try {
        const d = await enviarJSON('/api/importar/ne_pdf/gravar', 'POST', { notas });
        if (!d.ok) { showToast(d.error, 'error'); b.disabled = false; b.innerHTML = `${ico('file-upload')} Cadastrar`; return; }
        r.innerHTML = `<div class="import-msg ok">${ico('circle-check')}<div><strong>${d.criados.length} empenho(s) cadastrado(s).</strong>
            ${d.fornecedores_novos.length ? `Fornecedor(es) novo(s) no cadastro, já com o CNPJ: ${d.fornecedores_novos.map(escapeHTML).join(', ')}. Falta só o e-mail e o telefone.` : ''}
            <div class="ne-criados">${d.criados.map(c => `<a class="btn btn-secondary btn-sm" href="/empenhos?id=${c.id}">${ico('receipt')} ${escapeHTML(c.ne)}</a>`).join('')}</div></div></div>`;
        showToast('Empenhos cadastrados!', 'success');
        NE.arquivos = []; NE.notas = [];
        $('arquivosNe').value = ''; $('nomeNe').textContent = 'Escolha os PDFs das Notas de Empenho'; $('btnLerNe').disabled = true;
    } catch (err) { showToast(err.message, 'error'); b.disabled = false; b.innerHTML = `${ico('file-upload')} Cadastrar`; }
}

function iniciarNe() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => trocarAbaImportar(t.dataset.tab)));
    if (location.hash === '#planilha') trocarAbaImportar('xlsx');
    $('arquivosNe').addEventListener('change', (e) => escolherNe(e.target.files));
    const dz = $('dropNe');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('arrastando'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('arrastando'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) escolherNe(e.dataTransfer.files); });
    $('formNe').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!NE.arquivos.length) return;
        const b = $('btnLerNe'), txt = b.innerHTML;
        b.disabled = true;
        b.innerHTML = '<span class="spinner"></span> Lendo…';
        try {
            const fd = new FormData();
            NE.arquivos.forEach(f => fd.append('arquivos', f));
            const d = await fetchJSON('/api/importar/ne_pdf', { method: 'POST', body: fd });
            if (!d.ok) { showToast(d.error, 'error'); return; }
            NE.notas = d.notas;
            mostrarNotas();
        } catch (err) { showToast(err.message, 'error'); }
        finally { b.innerHTML = txt; b.disabled = !NE.arquivos.length; }
    });
}
