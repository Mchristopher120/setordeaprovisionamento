// Recursos que valem em todas as telas: busca geral (Ctrl+K), relatórios em PDF e backup.
// Carregado com "defer" pelo _topbar.html, depois do ui.js e do icones.js.
(function () {
    const el = (id) => document.getElementById(id);
    const abrir = (id) => { el(id).style.display = 'flex'; };
    const fechar = (id) => { el(id).style.display = 'none'; };
    const aberto = (id) => el(id).style.display === 'flex';
    const aviso = (msg, tipo) => (typeof showToast === 'function' ? showToast(msg, tipo) : alert(msg));

    ['modalBusca', 'modalRelatorios', 'modalBackup'].forEach(id => {
        el(id).addEventListener('mousedown', (e) => { if (e.target === el(id)) fechar(id); });
        el(id).querySelectorAll('[data-fechar-global]').forEach(b => b.addEventListener('click', () => fechar(id)));
    });
    document.querySelectorAll('[data-abrir-global]').forEach(b => b.addEventListener('click', () => {
        el('userMenu').hidden = true;
        if (b.dataset.abrirGlobal === 'modalRelatorios') abrirRelatorios(); else abrirBackup();
    }));
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBusca(); return; }
        if (e.key === 'Escape') ['modalBusca', 'modalRelatorios', 'modalBackup'].forEach(id => { if (aberto(id)) fechar(id); });
    });

    // ------------------------------------------------------------------ busca geral
    let buscaSeq = 0, buscaTimer = null, selecionado = -1;
    function abrirBusca() {
        abrir('modalBusca');
        const inp = el('buscaInput');
        inp.value = '';
        dica();
        setTimeout(() => inp.focus(), 20);
    }
    function dica() {
        selecionado = -1;
        el('buscaInput').setAttribute('aria-expanded', 'false');
        el('buscaResultados').innerHTML = `<p class="busca-dica">Digite pelo menos 2 letras ou números.<br>
            Exemplos: <kbd>219</kbd> acha a NE 219 · <kbd>batata</kbd> acha os empenhos com esse item · <kbd>9050</kbd> acha a NF.</p>`;
    }
    function marcar(i) {
        const itens = [...el('buscaResultados').querySelectorAll('.busca-item')];
        if (!itens.length) return;
        selecionado = (i + itens.length) % itens.length;
        itens.forEach((a, n) => a.classList.toggle('ativo', n === selecionado));
        itens[selecionado].scrollIntoView({ block: 'nearest' });
    }
    async function buscar() {
        const q = el('buscaInput').value.trim();
        if (q.length < 2) { dica(); return; }
        const seq = ++buscaSeq;
        let d;
        try { d = await fetchJSON(`/api/busca?q=${encodeURIComponent(q)}`); }
        catch (err) { if (seq === buscaSeq) el('buscaResultados').innerHTML = `<p class="busca-dica">${escapeHTML(err.message)}</p>`; return; }
        if (seq !== buscaSeq) return; // chegou resposta de uma digitação antiga
        const box = el('buscaResultados');
        if (!d.grupos.length) {
            box.innerHTML = `<p class="busca-dica">Nada encontrado para “${escapeHTML(q)}”.</p>`;
            el('buscaInput').setAttribute('aria-expanded', 'false');
            return;
        }
        box.innerHTML = d.grupos.map(g => `<div class="busca-grupo">${escapeHTML(g.titulo)}</div>` + g.itens.map(i => `
            <a class="busca-item" role="option" href="${escapeHTML(i.url)}">
                <span class="busca-ico">${ico(g.icone)}</span>
                <span class="busca-txt"><strong>${escapeHTML(i.titulo)}</strong><span>${escapeHTML(i.sub || '')}</span></span>
                ${i.extra ? `<span class="busca-extra">${escapeHTML(i.extra)}</span>` : ''}
            </a>`).join('')).join('');
        el('buscaInput').setAttribute('aria-expanded', 'true');
        marcar(0);
    }
    el('buscaBtn').addEventListener('click', abrirBusca);
    el('buscaInput').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(buscar, 160); });
    el('buscaInput').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); marcar(selecionado + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(selecionado - 1); }
        else if (e.key === 'Enter') {
            const a = el('buscaResultados').querySelectorAll('.busca-item')[selecionado];
            if (a) { e.preventDefault(); location.href = a.getAttribute('href'); }
        }
    });

    // ------------------------------------------------------------------ relatórios
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const br = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    let relCarregado = false;
    async function abrirRelatorios(preset) {
        abrir('modalRelatorios');
        const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
        const seg = new Date(hoje); seg.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
        el('relSemana').innerHTML = Array.from({ length: 10 }, (_, i) => {
            const a = new Date(seg); a.setDate(seg.getDate() - 7 * i);
            const b = new Date(a); b.setDate(a.getDate() + 6);
            return `<option value="${iso(a)}">${i === 0 ? 'Esta semana' : i === 1 ? 'Semana passada' : 'Semana'} (${br(a)} a ${br(b)})</option>`;
        }).join('');
        el('relMes').innerHTML = Array.from({ length: 12 }, (_, i) => {
            const m = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1, 12);
            const nome = m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            return `<option value="${iso(m)}">${nome.charAt(0).toUpperCase() + nome.slice(1)}${i === 0 ? ' (mês atual)' : ''}</option>`;
        }).join('');
        if (!relCarregado) {
            try {
                const emps = await fetchJSON('/api/empenhos');
                const anos = [...new Set(emps.map(e => e.ano).filter(Boolean))].sort().reverse();
                const forn = [...new Set(emps.map(e => e.nome_credor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
                el('relAno').innerHTML = '<option value="">Todos os anos</option>' + anos.map(a => `<option>${escapeHTML(a)}</option>`).join('');
                el('relForn').innerHTML = '<option value="">Todos os fornecedores</option>' + forn.map(f => `<option>${escapeHTML(f)}</option>`).join('');
                relCarregado = true;
            } catch (e) { /* os filtros são opcionais */ }
        }
        if (preset && preset.fornecedor !== undefined) el('relForn').value = preset.fornecedor;
    }
    window.abrirRelatorios = abrirRelatorios;

    /** Baixa um PDF mostrando o erro na tela se o servidor recusar (em vez de abrir uma página de erro). */
    async function baixar(url, botao) {
        const txt = botao.innerHTML;
        botao.disabled = true;
        botao.innerHTML = '<span class="spinner"></span> Gerando…';
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Não foi possível gerar o arquivo');
            const blob = await res.blob();
            const nome = (/filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'relatorio.pdf';
            const u = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(u), 4000);
            aviso(`${nome} baixado`, 'success');
        } catch (err) { aviso(err.message, 'error'); }
        finally { botao.disabled = false; botao.innerHTML = txt; }
    }
    el('relBaixarSit').addEventListener('click', (e) => {
        const q = new URLSearchParams();
        if (el('relAno').value) q.set('ano', el('relAno').value);
        if (el('relForn').value) q.set('fornecedor', el('relForn').value);
        if (el('relSaldo').checked) q.set('saldo', '1');
        baixar(`/api/relatorios/situacao.pdf?${q}`, e.currentTarget);
    });
    el('relBaixarSem').addEventListener('click', (e) => baixar(`/api/relatorios/periodo.pdf?tipo=semana&ref=${el('relSemana').value}`, e.currentTarget));
    el('relBaixarMes').addEventListener('click', (e) => baixar(`/api/relatorios/periodo.pdf?tipo=mes&ref=${el('relMes').value}`, e.currentTarget));

    // ------------------------------------------------------------------ backup
    const ROT = { empenhos: 'Empenhos', itens: 'Itens', pedidos: 'Pedidos', recebimentos: 'Linhas de NF', fornecedores: 'Fornecedores', auditoria: 'Registros do histórico' };
    let arquivoBk = null;
    function abrirBackup() {
        abrir('modalBackup');
        el('bkArquivo').value = '';
        el('bkPrevia').hidden = true;
        arquivoBk = null;
    }
    async function enviarBackup(confirmar) {
        const fd = new FormData();
        fd.append('arquivo', arquivoBk);
        if (confirmar) fd.append('confirmar', 'RESTAURAR');
        return fetchJSON('/api/backup/restaurar', { method: 'POST', body: fd });
    }
    el('bkArquivo').addEventListener('change', async (e) => {
        arquivoBk = e.target.files[0] || null;
        const box = el('bkPrevia');
        if (!arquivoBk) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '<p class="muted small"><span class="spinner"></span> Conferindo o arquivo…</p>';
        let d;
        try { d = await enviarBackup(false); } catch (err) { box.innerHTML = `<div class="import-msg erro">${ico('alert-triangle')}<div>${escapeHTML(err.message)}</div></div>`; return; }
        if (!d.ok) { box.innerHTML = `<div class="import-msg erro">${ico('alert-triangle')}<div>${escapeHTML(d.error)}</div></div>`; return; }
        const quando = d.gerado_em ? dataBR(d.gerado_em) : 'data desconhecida';
        box.innerHTML = `
            <div class="bk-comparar">
                <table><thead><tr><th></th><th>No arquivo</th><th>No sistema hoje</th></tr></thead><tbody>
                ${Object.keys(ROT).map(k => `<tr><td>${ROT[k]}</td><td><strong>${fmtNum(d.no_arquivo[k] || 0)}</strong></td><td>${fmtNum(d.no_sistema[k] || 0)}</td></tr>`).join('')}
                </tbody></table>
            </div>
            <div class="import-msg aviso">${ico('alert-triangle')}<div><strong>Backup feito em ${escapeHTML(quando)}${d.gerado_por ? ` por ${escapeHTML(d.gerado_por)}` : ''}.</strong>
                Ao restaurar, o que foi lançado depois dessa data se perde. Antes, baixe um backup do estado atual.</div></div>
            <label for="bkConfirma">Para confirmar, digite <strong>RESTAURAR</strong></label>
            <div class="bk-confirma"><input type="text" id="bkConfirma" autocomplete="off" placeholder="RESTAURAR">
                <button type="button" class="btn btn-danger" id="bkRestaurar" disabled>${ico('restore')} Restaurar este backup</button></div>`;
        const inp = el('bkConfirma'), btn = el('bkRestaurar');
        inp.addEventListener('input', () => { btn.disabled = inp.value.trim().toUpperCase() !== 'RESTAURAR'; });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Restaurando…';
            try {
                const r = await enviarBackup(true);
                if (!r.ok) throw new Error(r.error);
                box.innerHTML = `<div class="import-msg ok">${ico('circle-check')}<div><strong>Backup restaurado.</strong> A página vai recarregar.</div></div>`;
                setTimeout(() => location.reload(), 1200);
            } catch (err) { aviso(err.message, 'error'); btn.disabled = false; btn.innerHTML = `${ico('restore')} Restaurar este backup`; }
        });
    });
})();
