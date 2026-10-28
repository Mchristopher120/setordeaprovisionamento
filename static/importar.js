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
});
