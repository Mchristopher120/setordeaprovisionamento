const fmtMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtNum = (v) => new Intl.NumberFormat('pt-BR').format(v || 0);
const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

function pct(v) {
    return `${(parseFloat(v) || 0).toFixed(1).replace('.', ',')}%`;
}

function corPct(v, invert = false) {
    if (invert) {
        if (v >= 90) return 'var(--red)';
        if (v >= 50) return 'var(--amber)';
        return 'var(--green)';
    }
    if (v >= 90) return 'var(--green)';
    if (v >= 50) return 'var(--amber)';
    return 'var(--red)';
}

async function loadAll() {
    const [empenhos, stats] = await Promise.all([
        fetch('/api/empenhos').then(r => r.json()),
        fetch('/api/stats_empenhos').then(r => r.json()),
    ]);
    renderKPIs(stats);
    renderIndicadores(stats);
    renderTable(empenhos);
}

function renderKPIs(stats) {
    const kpis = document.getElementById('kpis');
    kpis.innerHTML = `
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
            <div class="kpi-sub">${fmtNum(stats.qtde_empenhada_total)} unidades</div>
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
            detail: `${fmtNum(stats.qtde_recebida_total)} de ${fmtNum(stats.qtde_empenhada_total)} unidades`,
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

    const grid = document.getElementById('indGrid');
    grid.innerHTML = ind.map(i => {
        const p = Math.min(100, Math.max(0, i.pct));
        return `
        <div class="ind-card">
            <div class="ind-head">
                <span class="ind-icon">${i.icone}</span>
                <span class="ind-label">${escapeHTML(i.label)}</span>
            </div>
            <div class="ind-value" style="color:${i.color}">${pct(i.pct)}</div>
            <div class="ind-bar"><span style="width:${p}%;background:${i.color}"></span></div>
            <div class="ind-detail">${escapeHTML(i.detail)}</div>
        </div>`;
    }).join('');
}

function renderTable(empenhos) {
    const tbody = document.getElementById('tableBody');
    document.getElementById('countBadge').textContent = `${fmtNum(empenhos.length)} empenhos`;

    if (!empenhos.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty">
            <span class="empty-icon">📦</span>
            Nenhum empenho cadastrado. Clique em "📦 Empenhos" para começar.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = empenhos.map(e => {
        const p = e.percentual_pago || 0;
        return `
        <tr>
            <td><strong>${escapeHTML(e.ne)}</strong></td>
            <td>${escapeHTML(e.nome_credor)}</td>
            <td>${escapeHTML(e.processo)}</td>
            <td class="num money">${fmtMoney(e.valor_empenhado)}</td>
            <td class="num money" style="color:var(--green)">${fmtMoney(e.valor_pago)}</td>
            <td class="num money" style="color:var(--red)">${fmtMoney(e.a_liquidar)}</td>
            <td class="num">${pct(p)}</td>
            <td><a href="/empenhos" class="btn btn-sm">Abrir</a></td>
        </tr>`;
    }).join('');
}

// ---------- Toast ----------
let toastTimer;
function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnRefresh').addEventListener('click', () => {
        showToast('Atualizando dados...');
        loadAll();
    });
    loadAll().catch(() => showToast('Erro ao carregar dados', 'error'));
});