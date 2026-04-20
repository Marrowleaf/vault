/* VAULT — Client-Side Finance App (IndexedDB) */

// ── IndexedDB Setup ────────────────────────────────────────────────────────
const DB_NAME = 'vault_db';
const DB_VERSION = 1;
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('subscriptions')) {
                const s = d.createObjectStore('subscriptions', { keyPath: 'id', autoIncrement: true });
                s.createIndex('category', 'category');
                s.createIndex('active', 'active');
            }
            if (!d.objectStoreNames.contains('transactions')) {
                const t = d.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                t.createIndex('date', 'date');
                t.createIndex('category', 'category');
                t.createIndex('type', 'type');
            }
            if (!d.objectStoreNames.contains('budgets')) {
                const b = d.createObjectStore('budgets', { keyPath: 'id', autoIncrement: true });
                b.createIndex('category', 'category');
            }
            if (!d.objectStoreNames.contains('networth')) {
                d.createObjectStore('networth', { keyPath: 'id', autoIncrement: true });
            }
            if (!d.objectStoreNames.contains('accounts')) {
                d.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbGet(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbAdd(store, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).add(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(store, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(store, id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2 });

function today() {
    return new Date().toISOString().split('T')[0];
}

function monthlyEquiv(amount, cycle) {
    if (cycle === 'weekly') return amount * 4.33;
    if (cycle === 'monthly') return amount;
    if (cycle === 'yearly') return amount / 12;
    return amount;
}

function daysUntil(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    now.setHours(0,0,0,0);
    d.setHours(0,0,0,0);
    return Math.ceil((d - now) / 86400000);
}

function budgetBarColor(pct) {
    if (pct < 50) return 'var(--success)';
    if (pct < 80) return 'var(--warning)';
    return 'var(--danger)';
}

// ── Tab Navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        // Refresh data when switching tabs
        if (btn.dataset.tab === 'dashboard') refreshDashboard();
        if (btn.dataset.tab === 'subscriptions') loadSubscriptions();
        if (btn.dataset.tab === 'transactions') loadTransactions();
        if (btn.dataset.tab === 'budgets') loadBudgets();
        if (btn.dataset.tab === 'networth') { loadNetWorth(); loadAccounts(); }
    });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
let dashChart = null;

async function refreshDashboard() {
    const subs = await dbGet('subscriptions');
    const txns = await dbGet('transactions');
    const budgets = await dbGet('budgets');

    const activeSubs = subs.filter(s => s.active);
    const monthlySubs = activeSubs.reduce((sum, s) => sum + monthlyEquiv(s.amount, s.cycle), 0);
    const yearlySubs = monthlySubs * 12;

    const now = new Date();
    const monthTxns = txns.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const income = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const net = income - expenses;

    document.getElementById('dash-monthly-subs').textContent = fmt(monthlySubs);
    document.getElementById('dash-yearly-subs').textContent = fmt(yearlySubs);
    document.getElementById('dash-income').textContent = fmt(income);
    document.getElementById('dash-expenses').textContent = fmt(expenses);
    document.getElementById('dash-net').textContent = (net >= 0 ? '✅ ' : '🔻 ') + fmt(Math.abs(net));
    document.getElementById('dash-net').style.color = net >= 0 ? 'var(--success)' : 'var(--danger)';

    // Upcoming bills (next 30 days)
    const upcoming = activeSubs
        .filter(s => daysUntil(s.next_due) >= 0 && daysUntil(s.next_due) <= 30)
        .sort((a, b) => daysUntil(a.next_due) - daysUntil(b.next_due));
    const upEl = document.getElementById('dash-upcoming');
    if (upcoming.length === 0) {
        upEl.innerHTML = '<div class="empty-state">No upcoming bills in the next 30 days ✅</div>';
    } else {
        upEl.innerHTML = upcoming.map(s => `
            <div class="bill-item">
                <span class="bill-name">${esc(s.name)}</span>
                <span class="bill-due">${daysUntil(s.next_due) === 0 ? 'Today' : daysUntil(s.next_due) + ' days'}</span>
                <span class="bill-amount">${fmt(s.amount)}</span>
            </div>
        `).join('');
    }

    // Overdue
    const overdue = activeSubs.filter(s => daysUntil(s.next_due) < 0);
    const ovEl = document.getElementById('dash-overdue');
    if (overdue.length === 0) {
        ovEl.innerHTML = '<div class="empty-state">No overdue bills ✅</div>';
    } else {
        ovEl.innerHTML = overdue.map(s => `
            <div class="bill-item overdue">
                <span class="bill-name">${esc(s.name)}</span>
                <span class="bill-due">${Math.abs(daysUntil(s.next_due))} days overdue</span>
                <span class="bill-amount">${fmt(s.amount)}</span>
            </div>
        `).join('');
    }

    // Budget status
    const bEl = document.getElementById('dash-budgets');
    if (budgets.length === 0) {
        bEl.innerHTML = '<div class="empty-state">No budgets set</div>';
    } else {
        bEl.innerHTML = budgets.map(b => {
            const spent = monthTxns.filter(t => t.type === 'expense' && t.category === b.category).reduce((s, t) => s + t.amount, 0);
            const pct = Math.min((spent / b.limit) * 100, 100);
            return `
                <div class="budget-bar-wrap">
                    <label><span>${esc(b.category)}: ${fmt(spent)} / ${fmt(b.limit)}</span><span>${pct.toFixed(0)}%</span></label>
                    <div class="budget-bar"><div class="budget-bar-fill" style="width:${pct}%;background:${budgetBarColor(pct)}"></div></div>
                </div>
            `;
        }).join('');
    }

    // Spending trend chart (last 6 months)
    buildDashChart(txns);
}

function buildDashChart(txns) {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ label: d.toLocaleString('en-GB', { month: 'short', year: '2-digit' }), month: d.getMonth(), year: d.getFullYear() });
    }
    const incData = months.map(m => txns.filter(t => t.type === 'income' && new Date(t.date).getMonth() === m.month && new Date(t.date).getFullYear() === m.year).reduce((s, t) => s + t.amount, 0));
    const expData = months.map(m => txns.filter(t => t.type === 'expense' && new Date(t.date).getMonth() === m.month && new Date(t.date).getFullYear() === m.year).reduce((s, t) => s + t.amount, 0));

    if (dashChart) dashChart.destroy();
    const ctx = document.getElementById('dash-chart');
    if (!ctx) return;
    dashChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months.map(m => m.label),
            datasets: [
                { label: 'Income', data: incData, backgroundColor: '#00d672aa' },
                { label: 'Expenses', data: expData, backgroundColor: '#e94560aa' }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#a0a0b0' } } },
            scales: {
                x: { ticks: { color: '#a0a0b0' }, grid: { color: '#2a2a4e' } },
                y: { ticks: { color: '#a0a0b0', callback: v => '£' + v }, grid: { color: '#2a2a4e' } }
            }
        }
    });
}

// ── Subscriptions ───────────────────────────────────────────────────────────
async function loadSubscriptions() {
    const subs = await dbGet('subscriptions');
    const showInactive = document.getElementById('sub-show-inactive').checked;
    const filterCat = document.getElementById('sub-filter-cat').value;

    // Populate category filter
    const cats = [...new Set(subs.map(s => s.category))].sort();
    const catEl = document.getElementById('sub-filter-cat');
    const currentVal = catEl.value;
    catEl.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    catEl.value = currentVal;

    let filtered = subs;
    if (!showInactive) filtered = filtered.filter(s => s.active);
    if (filterCat) filtered = filtered.filter(s => s.category === filterCat);

    const list = document.getElementById('sub-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">No subscriptions yet</div>';
    } else {
        list.innerHTML = filtered.map(s => `
            <div class="item">
                <div class="item-info">
                    <span class="name">${esc(s.name)}</span>
                    <span class="meta">${esc(s.category)} · ${s.cycle} · Due: ${s.next_due}${!s.active ? ' · INACTIVE' : ''}</span>
                </div>
                <span class="item-amount">${fmt(s.amount)}</span>
                <div class="item-actions">
                    <button class="btn-small" onclick="toggleSub(${s.id})">${s.active ? 'Deactivate' : 'Activate'}</button>
                    <button class="btn-danger" onclick="delSub(${s.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    const activeSubs = subs.filter(s => s.active);
    const monthly = activeSubs.reduce((s, sub) => s + monthlyEquiv(sub.amount, sub.cycle), 0);
    document.getElementById('sub-monthly-total').textContent = fmt(monthly);
    document.getElementById('sub-yearly-total').textContent = fmt(monthly * 12);
}

document.getElementById('sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dbAdd('subscriptions', {
        name: document.getElementById('sub-name').value,
        amount: parseFloat(document.getElementById('sub-amount').value),
        cycle: document.getElementById('sub-cycle').value,
        next_due: document.getElementById('sub-next-due').value,
        category: document.getElementById('sub-category').value,
        url: document.getElementById('sub-url').value || null,
        notes: document.getElementById('sub-notes').value || null,
        active: true,
        created_at: new Date().toISOString()
    });
    e.target.reset();
    document.getElementById('sub-next-due').value = '';
    loadSubscriptions();
    refreshDashboard();
});

async function toggleSub(id) {
    const tx = db.transaction('subscriptions', 'readwrite');
    const store = tx.objectStore('subscriptions');
    const req = store.get(id);
    req.onsuccess = () => {
        const s = req.result;
        s.active = !s.active;
        store.put(s);
        loadSubscriptions();
        refreshDashboard();
    };
}

async function delSub(id) {
    if (confirm('Delete this subscription?')) {
        await dbDelete('subscriptions', id);
        loadSubscriptions();
        refreshDashboard();
    }
}

document.getElementById('sub-show-inactive').addEventListener('change', loadSubscriptions);
document.getElementById('sub-filter-cat').addEventListener('change', loadSubscriptions);

// ── Transactions ─────────────────────────────────────────────────────────────
async function loadTransactions() {
    const txns = await dbGet('transactions');
    const search = document.getElementById('txn-search').value.toLowerCase();
    const filterType = document.getElementById('txn-filter-type').value;
    const filterCat = document.getElementById('txn-filter-cat').value;

    // Populate category filter
    const cats = [...new Set(txns.map(t => t.category))].sort();
    const catEl = document.getElementById('txn-filter-cat');
    const currentVal = catEl.value;
    catEl.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    catEl.value = currentVal;

    let filtered = txns.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (search) filtered = filtered.filter(t => t.description.toLowerCase().includes(search) || t.category.toLowerCase().includes(search));
    if (filterType) filtered = filtered.filter(t => t.type === filterType);
    if (filterCat) filtered = filtered.filter(t => t.category === filterCat);

    const list = document.getElementById('txn-list');
    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">No transactions yet</div>';
    } else {
        list.innerHTML = filtered.map(t => `
            <div class="item">
                <div class="item-info">
                    <span class="name">${esc(t.description)}</span>
                    <span class="meta">${t.date} · ${esc(t.category)}${t.account ? ' · ' + esc(t.account) : ''}</span>
                </div>
                <span class="item-amount ${t.type}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</span>
                <div class="item-actions">
                    <button class="btn-danger" onclick="delTxn(${t.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    const total = filtered.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    document.getElementById('txn-total').textContent = fmt(total);
}

document.getElementById('txn-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dbAdd('transactions', {
        date: document.getElementById('txn-date').value,
        amount: parseFloat(document.getElementById('txn-amount').value),
        type: document.getElementById('txn-type').value,
        description: document.getElementById('txn-description').value,
        category: document.getElementById('txn-category').value,
        account: document.getElementById('txn-account').value || null,
        created_at: new Date().toISOString()
    });
    e.target.reset();
    loadTransactions();
    refreshDashboard();
});

async function delTxn(id) {
    if (confirm('Delete this transaction?')) {
        await dbDelete('transactions', id);
        loadTransactions();
        refreshDashboard();
    }
}

document.getElementById('txn-search').addEventListener('input', loadTransactions);
document.getElementById('txn-filter-type').addEventListener('change', loadTransactions);
document.getElementById('txn-filter-cat').addEventListener('change', loadTransactions);

// CSV Import
document.getElementById('txn-import-btn').addEventListener('click', async () => {
    const file = document.getElementById('txn-csv').files[0];
    if (!file) return alert('Select a CSV file first');
    const text = await file.text();
    const lines = text.trim().split('\n');
    let count = 0;
    for (const line of lines) {
        const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
        if (parts.length < 5) continue;
        if (parts[0].toLowerCase() === 'date') continue; // skip header
        await dbAdd('transactions', {
            date: parts[0],
            amount: parseFloat(parts[1]) || 0,
            description: parts[2] || '',
            category: parts[3] || 'Imported',
            type: parts[4] || 'expense',
            account: parts[5] || null,
            created_at: new Date().toISOString()
        });
        count++;
    }
    alert(`Imported ${count} transactions`);
    document.getElementById('txn-csv').value = '';
    loadTransactions();
    refreshDashboard();
});

// ── Budgets ─────────────────────────────────────────────────────────────────
let budgetChart = null;

async function loadBudgets() {
    const budgets = await dbGet('budgets');
    const txns = await dbGet('transactions');
    const now = new Date();
    const monthTxns = txns.filter(t => {
        const d = new Date(t.date);
        return t.type === 'expense' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    const list = document.getElementById('budget-list');
    if (budgets.length === 0) {
        list.innerHTML = '<div class="empty-state">No budgets set</div>';
    } else {
        list.innerHTML = budgets.map(b => {
            const spent = monthTxns.filter(t => t.category === b.category).reduce((s, t) => s + t.amount, 0);
            const pct = Math.min((spent / b.limit) * 100, 100);
            return `
                <div class="budget-bar-wrap">
                    <label>
                        <span>${esc(b.category)}: ${fmt(spent)} / ${fmt(b.limit)}</span>
                        <span>${pct.toFixed(0)}%</span>
                    </label>
                    <div class="budget-bar">
                        <div class="budget-bar-fill" style="width:${pct}%;background:${budgetBarColor(pct)}"></div>
                    </div>
                    <button class="btn-danger" style="margin-top:4px" onclick="delBudget(${b.id})">Delete</button>
                </div>
            `;
        }).join('');
    }

    // Budget chart
    if (budgetChart) budgetChart.destroy();
    if (budgets.length > 0) {
        const ctx = document.getElementById('budget-chart');
        budgetChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: budgets.map(b => b.category),
                datasets: [{
                    data: budgets.map(b => b.limit),
                    backgroundColor: ['#e94560', '#00d672', '#ffc107', '#0f3460', '#a855f7', '#06b6d4']
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { labels: { color: '#a0a0b0' } } }
            }
        });
    }
}

document.getElementById('budget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cat = document.getElementById('budget-category').value;
    const limit = parseFloat(document.getElementById('budget-limit').value);
    // Check if budget for this category already exists
    const budgets = await dbGet('budgets');
    const existing = budgets.find(b => b.category === cat);
    if (existing) {
        existing.limit = limit;
        await dbPut('budgets', existing);
    } else {
        await dbAdd('budgets', { category: cat, limit: limit, created_at: new Date().toISOString() });
    }
    e.target.reset();
    loadBudgets();
    refreshDashboard();
});

async function delBudget(id) {
    if (confirm('Delete this budget?')) {
        await dbDelete('budgets', id);
        loadBudgets();
        refreshDashboard();
    }
}

// ── Net Worth ───────────────────────────────────────────────────────────────
let nwChart = null;

async function loadNetWorth() {
    const entries = await dbGet('networth');
    const list = document.getElementById('nw-list');
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (entries.length === 0) {
        list.innerHTML = '<div class="empty-state">No entries yet</div>';
    } else {
        list.innerHTML = entries.map(e => `
            <div class="item">
                <div class="item-info">
                    <span class="name">${e.date}</span>
                    <span class="meta">Assets: ${fmt(e.assets)} · Liabilities: ${fmt(e.liabilities)}${e.notes ? ' · ' + esc(e.notes) : ''}</span>
                </div>
                <span class="item-amount ${e.assets - e.liabilities >= 0 ? 'income' : 'expense'}">${fmt(e.assets - e.liabilities)}</span>
                <div class="item-actions">
                    <button class="btn-danger" onclick="delNW(${e.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }

    // Chart
    if (nwChart) nwChart.destroy();
    if (entries.length > 0) {
        const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        const ctx = document.getElementById('nw-chart');
        nwChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sorted.map(e => e.date),
                datasets: [{
                    label: 'Net Worth',
                    data: sorted.map(e => e.assets - e.liabilities),
                    borderColor: '#e94560',
                    backgroundColor: '#e9456033',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { labels: { color: '#a0a0b0' } } },
                scales: {
                    x: { ticks: { color: '#a0a0b0' }, grid: { color: '#2a2a4e' } },
                    y: { ticks: { color: '#a0a0b0', callback: v => '£' + v }, grid: { color: '#2a2a4e' } }
                }
            }
        });
    }
}

document.getElementById('nw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dbAdd('networth', {
        date: document.getElementById('nw-date').value,
        assets: parseFloat(document.getElementById('nw-assets').value),
        liabilities: parseFloat(document.getElementById('nw-liabilities').value),
        notes: document.getElementById('nw-notes').value || null,
        created_at: new Date().toISOString()
    });
    e.target.reset();
    loadNetWorth();
});

async function delNW(id) {
    if (confirm('Delete this entry?')) {
        await dbDelete('networth', id);
        loadNetWorth();
    }
}

// ── Accounts ────────────────────────────────────────────────────────────────
async function loadAccounts() {
    const accts = await dbGet('accounts');
    const list = document.getElementById('acct-list');
    if (accts.length === 0) {
        list.innerHTML = '<div class="empty-state">No accounts yet</div>';
    } else {
        list.innerHTML = accts.map(a => `
            <div class="item">
                <div class="item-info">
                    <span class="name">${esc(a.name)}</span>
                    <span class="meta">${a.type}</span>
                </div>
                <span class="item-amount ${a.balance >= 0 ? 'income' : 'expense'}">${fmt(a.balance)}</span>
                <div class="item-actions">
                    <button class="btn-danger" onclick="delAcct(${a.id})">Delete</button>
                </div>
            </div>
        `).join('');
    }
}

document.getElementById('acct-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await dbAdd('accounts', {
        name: document.getElementById('acct-name').value,
        type: document.getElementById('acct-type').value,
        balance: parseFloat(document.getElementById('acct-balance').value),
        created_at: new Date().toISOString()
    });
    e.target.reset();
    loadAccounts();
});

async function delAcct(id) {
    if (confirm('Delete this account?')) {
        await dbDelete('accounts', id);
        loadAccounts();
    }
}

// ── Utility ────────────────────────────────────────────────────────────────
function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── Init ────────────────────────────────────────────────────────────────────
(async () => {
    await openDB();

    // Set default date inputs to today
    document.getElementById('sub-next-due').value = today();
    document.getElementById('txn-date').value = today();
    document.getElementById('nw-date').value = today();

    // Seed demo data if empty
    const subs = await dbGet('subscriptions');
    if (subs.length === 0) {
        await dbAdd('subscriptions', { name: 'Netflix', amount: 10.99, cycle: 'monthly', next_due: '2026-04-22', category: 'Entertainment', url: 'https://netflix.com', notes: null, active: true, created_at: new Date().toISOString() });
        await dbAdd('subscriptions', { name: 'Spotify', amount: 9.99, cycle: 'monthly', next_due: '2026-04-24', category: 'Entertainment', url: 'https://spotify.com', notes: null, active: true, created_at: new Date().toISOString() });
        await dbAdd('subscriptions', { name: 'Amazon Prime', amount: 95.88, cycle: 'yearly', next_due: '2026-11-15', category: 'Shopping', url: 'https://amazon.co.uk', notes: null, active: true, created_at: new Date().toISOString() });
        await dbAdd('subscriptions', { name: 'Gym', amount: 29.99, cycle: 'monthly', next_due: '2026-05-01', category: 'Health', url: null, notes: null, active: true, created_at: new Date().toISOString() });
        await dbAdd('transactions', { date: '2026-04-01', amount: 3000, type: 'income', description: 'Salary', category: 'Salary', account: 'Current', created_at: new Date().toISOString() });
        await dbAdd('transactions', { date: '2026-04-05', amount: 77.50, type: 'expense', description: 'Weekly shop', category: 'Food', account: 'Current', created_at: new Date().toISOString() });
        await dbAdd('transactions', { date: '2026-04-10', amount: 45, type: 'expense', description: 'Train ticket', category: 'Transport', account: 'Current', created_at: new Date().toISOString() });
        await dbAdd('transactions', { date: '2026-04-12', amount: 250, type: 'expense', description: 'Rent', category: 'Bills', account: 'Current', created_at: new Date().toISOString() });
        await dbAdd('transactions', { date: '2026-04-15', amount: 35, type: 'expense', description: 'Clothes', category: 'Shopping', account: 'Current', created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Food', limit: 300, created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Entertainment', limit: 80, created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Transport', limit: 100, created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Bills', limit: 400, created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Shopping', limit: 150, created_at: new Date().toISOString() });
        await dbAdd('budgets', { category: 'Health', limit: 50, created_at: new Date().toISOString() });
    }

    refreshDashboard();
    loadSubscriptions();
    loadTransactions();
    loadBudgets();
    loadNetWorth();
    loadAccounts();
})();