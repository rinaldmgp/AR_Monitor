/**
 * KONFIGURASI API
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbzDdqXcsA5OdozIr1etmavbiIRuutqB37ZGV10ag86nwcUjExaNRx54J_BvtjFMA6tk/exec'; 

// STATE UTAMA
let clientsDB = [];
let currentClient = null;
let selectedContract = null;
let currentBillingIndex = null;
let viewMode = 'grid'; 
let generatedBillingsCache = []; 
let selectedBulkItems = []; // Menyimpan item yang dicentang
let bulkTotalAmountCache = 0; // Cache total tagihan kotor
let currentGroupBillings = [];

// STATE UI
let listFilterStatus = 'all'; 
let listSortAge = 'asc'; 
let listFilterDate = '';

// --- STATE GROUP / MEMBERS ---
let clientGroupsRaw = []; // Data mentah dari API (Sheet ClientGroups)
let currentGroupMembers = []; // Array ID member yang aktif saat ini
let groupFilterState = {
    status: 'unpaid', // Default Unpaid
    location: '',
    period: '',
    selectedIds: [], // ID client yang dicentang user
    sort: 'desc', // desc = Tua ke Muda (Default)
    dateRec: '',
    datePay: ''
};
// HISTORY CONFIG
const HISTORY_KEY = 'etos_erp_search_history';
const MAX_HISTORY = 5;

// === INISIALISASI ===
document.addEventListener('DOMContentLoaded', () => {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').innerText = new Date().toLocaleDateString('id-ID', options);
    
    // Set state awal history browser
    history.replaceState({ page: 'ar_monitor' }, null, "#ar_monitor");
    
    loadData();
});

// === STATE MANAGEMENT ===
function saveAppState() {
    const state = {
        clientId: currentClient ? currentClient.id : null,
        contractId: selectedContract ? selectedContract.id_uniq : null,
        contractService: selectedContract ? selectedContract.service_type : null,
        contractLocation: selectedContract ? selectedContract.location : null, // [BARU] Simpan Lokasi
        viewMode: viewMode
    };
    localStorage.setItem('etos_erp_state', JSON.stringify(state));
}

function loadAppState() {
    const saved = localStorage.getItem('etos_erp_state');
    return saved ? JSON.parse(saved) : null;
}

// === HISTORY SEARCH LOGIC (LOCALSTORAGE) ===
function getHistory() {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveToHistory(name) {
    if (!name) return;
    let history = getHistory();
    history = history.filter(item => item !== name);
    history.unshift(name);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function deleteHistoryItem(e, name) {
    e.stopPropagation();
    let history = getHistory();
    history = history.filter(item => item !== name);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderHistoryList();
    if (history.length === 0) document.getElementById('arHistoryPanel').classList.add('hidden');
}

function renderHistoryList() {
    const history = getHistory();
    const listContainer = document.getElementById('historyListContent');
    const panel = document.getElementById('arHistoryPanel');
    listContainer.innerHTML = '';
    if (history.length === 0) { panel.classList.add('hidden'); return; }

    history.forEach(name => {
        const div = document.createElement('div');
        div.className = 'ar-history-item';
        div.onclick = () => applyHistorySearch(name);
        div.innerHTML = `
            <div class="ar-h-left"><i class="ri-time-line"></i><span class="ar-h-text">${name}</span></div>
            <button class="btn-del-hist" onclick="deleteHistoryItem(event, '${name}')"><i class="ri-close-line"></i></button>
        `;
        listContainer.appendChild(div);
    });
}

function applyHistorySearch(name) {
    const input = document.getElementById('arSearchInput');
    input.value = name;
    document.getElementById('arHistoryPanel').classList.add('hidden');
    input.dispatchEvent(new Event('keyup'));
}

function setupHistoryEvents() {
    const input = document.getElementById('arSearchInput');
    const panel = document.getElementById('arHistoryPanel');
    if(!input) return;

    input.addEventListener('focus', () => {
        const history = getHistory();
        if (history.length > 0) { renderHistoryList(); panel.classList.remove('hidden'); }
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !panel.contains(e.target)) panel.classList.add('hidden');
    });
    input.addEventListener('input', () => {
        if (input.value.length > 0) panel.classList.add('hidden');
        else {
            const history = getHistory();
            if (history.length > 0) { renderHistoryList(); panel.classList.remove('hidden'); }
        }
    });
}

// === CRUD & LOAD DATA ===

async function loadData(maintainState = false) {
    try {
        const response = await fetch(API_URL, { method: 'GET', redirect: 'follow' });
        if (!response.ok) throw new Error("Server error: " + response.status);

        const result = await response.json();
        
        document.getElementById('loading-screen').style.display = 'none';
        
        // --- 1. PARSING DATA (Support Format Baru & Lama) ---
        if (result.clients) {
            // FORMAT BARU: { clients: [...], groups: [...] }
            clientsDB = result.clients;
            clientGroupsRaw = result.groups || []; 
        } else {
            // FORMAT LAMA: [...] (Array langsung)
            clientsDB = result;
            clientGroupsRaw = [];
        } 
        
        console.log("Data Loaded. Client Count:", clientsDB.length, "Group Count:", clientGroupsRaw.length);

        const savedState = loadAppState();

        // --- 2. LOGIKA MAINTAIN STATE (Saat Update Data / Bayar) ---
        if (maintainState && currentClient) {
            const freshClient = clientsDB.find(c => c.id === currentClient.id);
            if (freshClient) {
                currentClient = freshClient;

                // === [UPDATE PENTING] CEK VIEW MODE GROUP ===
                // Jika viewMode adalah 'group', render ulang halaman Group
                if (viewMode === 'group') {
                    openClientGroupView(); 
                    return; // Stop di sini, jangan lanjut render profil biasa
                }
                // ============================================

                if (selectedContract) {
                    // Update Kontrak Terpilih dengan Data Baru
                    const freshContract = currentClient.contracts.find(c => 
                        c.id_uniq === selectedContract.id_uniq && 
                        c.service_type === selectedContract.service_type &&
                        c.location === selectedContract.location 
                    );
                    
                    if (freshContract) {
                        selectedContract = freshContract;
                        if (viewMode === 'list' && !document.querySelector('.contracts-grid')) {
                             renderClientProfile(currentClient); 
                        } else {
                             openBillingDetail(freshContract.id_uniq, freshContract.service_type, freshContract.location);
                        }
                    } else {
                        selectedContract = null;
                        renderClientProfile(currentClient); 
                    }
                } else {
                    renderClientProfile(currentClient);
                }
            }
        
        // --- 3. LOGIKA LOAD STATE (Saat Refresh Browser F5) ---
        } else if (savedState && savedState.clientId) {
            const client = clientsDB.find(c => c.id === savedState.clientId);
            if (client) {
                currentClient = client;
                viewMode = savedState.viewMode || 'grid';

                // === [UPDATE PENTING] RESTORE HALAMAN GROUP ===
                if (viewMode === 'group') {
                    openClientGroupView();
                    return;
                }
                // ==============================================

                if (savedState.contractId) {
                    renderClientProfile(currentClient);
                    const contract = currentClient.contracts.find(c => 
                        c.id_uniq === savedState.contractId && 
                        (savedState.contractService ? c.service_type === savedState.contractService : true) &&
                        (savedState.contractLocation ? c.location === savedState.contractLocation : true)
                    );
                    if(contract) openBillingDetail(contract.id_uniq, contract.service_type, contract.location);
                } else {
                    renderClientProfile(currentClient);
                }
            } else {
                navigate('ar_monitor', false);
            }
        
        // --- 4. DEFAULT (Halaman Depan) ---
        } else {
            navigate('ar_monitor', false);
        }

    } catch (error) {
        console.error(error);
        const loader = document.getElementById('loading-screen');
        if(loader) {
            loader.style.display = 'flex'; 
            loader.innerHTML = `<div style="color:red; text-align:center;"><h3>Gagal mengambil data</h3><p>${error.message}</p></div>`;
        }
    }
}

async function sendData(payload, silent = false) {
    const btn = document.querySelector('.btn-submit') || document.querySelector('.btn-save-dark');
    const originalText = btn ? btn.innerText : '';
    if(btn) { btn.innerText = 'Menyimpan...'; btn.disabled = true; }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            redirect: 'follow',
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();

        if(result.status === 'error') {
            alert("GAGAL: " + result.message);
        } else {
            await loadData(true); 
            if(!silent) alert("Berhasil disimpan!");
        }

    } catch (error) {
        alert("Gagal koneksi: " + error);
    } finally {
        if(btn) { btn.innerText = originalText; btn.disabled = false; }
    }
}

// === UTILS FORMATTING & CALCULATION ===

function formatInputCurrency(input) {
    let value = input.value.replace(/[^0-9\-]/g, ''); 
    if ((value.match(/-/g) || []).length > 1) { value = value.replace(/-/g, ''); value = '-' + value; }
    if (value && value !== '-') {
        let isNegative = value.startsWith('-');
        let cleanVal = value.replace('-', '');
        let formatted = parseInt(cleanVal, 10).toLocaleString('id-ID');
        input.value = isNegative ? '-' + formatted : formatted;
    } else { input.value = value; }
    updateCalculations(); 
}

function getRawValue(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    let val = el.value;
    if (!val) return 0;
    val = val.replace(/\./g, '');
    if (val === '-') return 0;
    return parseInt(val, 10);
}

function updateCalculations() {
    const dpp = getRawValue('inp-dpp');
    const isPPN = document.getElementById('chk-ppn') ? document.getElementById('chk-ppn').checked : false;
    let ppnVal = isPPN ? Math.round(dpp * 0.11) : 0;
    const totalTagihan = dpp + ppnVal;

    if(document.getElementById('txt-ppn-val')) document.getElementById('txt-ppn-val').innerText = 'Rp ' + ppnVal.toLocaleString('id-ID');
    if(document.getElementById('txt-total-bill')) document.getElementById('txt-total-bill').innerText = 'Rp ' + totalTagihan.toLocaleString('id-ID');

    const isPPh = document.getElementById('chk-pph') ? document.getElementById('chk-pph').checked : false;
    let pphVal = 0;
    if (isPPh) {
        pphVal = Math.round(dpp * 0.02);
        if(document.getElementById('lbl-pph-val')) {
            document.getElementById('lbl-pph-val').innerText = `(Potong: Rp ${pphVal.toLocaleString('id-ID')})`;
            document.getElementById('lbl-pph-val').style.display = 'inline';
        }
    } else { 
        if(document.getElementById('lbl-pph-val')) document.getElementById('lbl-pph-val').style.display = 'none'; 
    }

    const admin = getRawValue('inp-admin');
    const overunder = getRawValue('inp-overunder');
    let netPayment = totalTagihan - pphVal - admin + overunder;

    const statusVal = document.getElementById('inp-status') ? document.getElementById('inp-status').value : '';
    if(statusVal === 'Pemutihan') netPayment = 0;

    const inpNet = document.getElementById('inp-net-payment');
    if (inpNet) inpNet.value = "Rp " + netPayment.toLocaleString('id-ID');
}

function formatDateInput(str) { 
    if(!str) return ''; 
    const d = new Date(str);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; 
}

function formatPeriod(str) { 
    if(!str) return '-'; 
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return str;
}
function formatMonthYear(str) { if(!str) return '-'; return new Date(str).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); }
function formatDate(str) { 
    if(!str) return '-'; 
    const d = new Date(str);
    if (isNaN(d.getTime())) return '-';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`; 
}

function getAgeColor(days) {
    if (days > 60) return '#ef5350'; 
    if (days >= 30) return '#ffca28'; 
    return '#42a5f5'; 
}

// === UI NAVIGATION LOGIC ===

function navigate(page, addToHistory = true) {
    document.body.classList.remove('mode-fixed');
    const container = document.getElementById('app-container');
    const title = document.getElementById('page-title');
    
    // 1. History Browser
    if (addToHistory) {
        history.pushState({ page: page }, null, `#${page}`);
    }

    container.innerHTML = '';
    
    if(page === 'ar_monitor') {
        currentClient = null;
        selectedContract = null;
        // Kita TIDAK menghapus localStorage state agar filter umur tetap tersimpan
    }

    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    
    if (page === 'dashboard') {
        document.querySelector('.menu-item[onclick="navigate(\'dashboard\')"]').classList.add('active');
        title.innerText = "Ringkasan";
        container.innerHTML = `<div style="text-align:center; padding-top:50px; color:#546e7a;"><h3>Selamat Datang di ETOS ERP</h3><p>Pilih AR Monitor untuk memulai.</p></div>`;
    
    } else if (page === 'ar_monitor') {
        document.querySelector('.menu-item[onclick="navigate(\'ar_monitor\')"]').classList.add('active');
        title.innerText = "AR Monitor";

        // Generate Opsi 1-100
        let ageOptions = '<option value="" disabled selected>Pilih Umur...</option>';
        for(let i = 1; i <= 100; i++) {
            ageOptions += `<option value="${i}">${i} Hari</option>`;
        }

        const lastAge = localStorage.getItem('etos_last_age_search');

        container.innerHTML = `
            <div class="ar-search-container">
                <div class="ar-hero-text">
                    <h3>Pencarian Data Pelanggan</h3>
                    <p>Ketik nama pelanggan atau nomor kontrak.</p>
                    <button onclick="openNewContractModal()" style="margin-top: 15px; background: #00c853; color: white; border: none; padding: 10px 25px; border-radius: 50px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 10px rgba(0, 200, 83, 0.3); display: inline-flex; align-items: center; gap: 8px; transition: transform 0.2s;">
                    <i class="ri-add-circle-line" style="font-size: 18px;"></i> INPUT KONTRAK BARU
                </button>
                </div>
                
                <div class="search-widget-large">
                    <i class="ri-search-line search-icon-large"></i>
                    <input type="text" id="arSearchInput" placeholder="Cari Nama Client / No Kontrak..." autocomplete="off">
                    <div id="arHistoryPanel" class="ar-history-panel hidden">
                        <div class="ar-history-header">PENCARIAN TERAKHIR</div>
                        <div id="historyListContent" class="ar-history-list"></div>
                    </div>
                </div>
                <div id="arSearchResults" class="ar-results hidden"></div>

                <div style="width: 100%; height: 1px; background: #cfd8dc; margin: 40px 0 20px 0;"></div>

                <div style="text-align: left; width: 100%;">
                    <label style="color: #37474f; font-weight: 800; font-size: 18px; display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                        <i class="ri-bar-chart-horizontal-line" style="color:var(--accent-teal)"></i> Monitor Umur Tagihan
                    </label>
                    <p style="color: #78909c; font-size: 13px; margin-bottom: 10px;">Menampilkan tagihan umur X s/d X+6 (7 Kolom).</p>
                    
                    <div style="display: flex; gap: 10px; max-width: 300px;">
                        <select id="globalAgeInput" onchange="runGlobalAgeSearch()" 
                               style="flex:1; padding: 10px; border: 2px solid #b0bec5; border-radius: 6px; font-size: 15px; font-weight: bold; color: #37474f; cursor:pointer; background:white;">
                               ${ageOptions}
                        </select>
                    </div>
                </div>

                <div id="globalAgeResults" class="hidden" style="margin-top: 20px; display: flex; gap: 15px; overflow-x: auto; padding-bottom: 20px; align-items: flex-start; width: 100%;"></div>
            </div>
        `;
        setupARSearch();
        setupHistoryEvents();

        // OTOMATIS LOAD FILTER TERAKHIR JIKA ADA
        if (lastAge) {
            const dropdown = document.getElementById('globalAgeInput');
            if(dropdown) {
                dropdown.value = lastAge;
                runGlobalAgeSearch(); 
            }
        }
    }
}

function setupARSearch() {
    const input = document.getElementById('arSearchInput');
    const results = document.getElementById('arSearchResults');
    const historyPanel = document.getElementById('arHistoryPanel');
    
    if(!input) return;

    input.addEventListener('keyup', (e) => {
        const keyword = e.target.value.toLowerCase();
        
        // Sembunyikan panel history saat mengetik
        if (historyPanel) historyPanel.classList.add('hidden');
        
        // Jika input kosong, sembunyikan hasil
        if (keyword.length < 1) { results.classList.add('hidden'); return; }

        // --- FILTER LOGIC (DIPERBAIKI) ---
        const filtered = clientsDB.filter(c => 
            // 1. Cari berdasarkan NAMA
            c.name.toLowerCase().includes(keyword) || 
            // 2. Cari berdasarkan ID CLIENT (Tambahan Baru)
            String(c.id).toLowerCase().includes(keyword) ||
            // 3. Cari berdasarkan NO KONTRAK
            c.contracts.some(ctr => ctr.no_kontrak.toLowerCase().includes(keyword))
        );

        if (filtered.length > 0) {
            results.innerHTML = filtered.map(c => `
                <div class="ar-res-item" onclick="selectClient('${c.id}')">
                    <div class="res-icon"><i class="ri-building-4-line"></i></div>
                    <div class="res-info">
                        <strong>${c.name}</strong>
                        <small>ID: ${c.id} | ${c.contracts.length} Kontrak | ${c.address || 'Indonesia'}</small>
                    </div>
                    <i class="ri-arrow-right-line" style="color:#90a4ae"></i>
                </div>`).join('');
            results.classList.remove('hidden');
        } else {
            results.innerHTML = `<div style="padding:20px; text-align:center; color:#e57373;">Data tidak ditemukan</div>`;
            results.classList.remove('hidden');
        }
    });
}

function selectClient(id, pushToHistory = true) {
    currentClient = clientsDB.find(c => c.id === id);
    if(currentClient) {
        saveToHistory(currentClient.name);
        viewMode = 'grid'; 
        listFilterDate = ''; 
        saveAppState(); 

        if (pushToHistory) {
            history.pushState({ page: 'client_detail', clientId: id }, null, `#client_${id}`);
        }

        renderClientProfile(currentClient);
    }
}

// === GLOBAL AGE MONITOR LOGIC ===

function runGlobalAgeSearch() {
    const inputVal = document.getElementById('globalAgeInput').value;
    const container = document.getElementById('globalAgeResults');
    
    if (!inputVal) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    localStorage.setItem('etos_last_age_search', inputVal);

    const startAge = parseInt(inputVal);
    const endAge = startAge + 6;
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    let columnsData = [[], [], [], [], [], [], []]; 

    // LOOP SEMUA CLIENT
    clientsDB.forEach(client => {
        
        // 1. DATA IDENTIFIED (Punya Kontrak)
        client.contracts.forEach(contract => {
            contract.billings.forEach(bill => {
                const isPaidValid = (bill.status === 'Paid' && bill.paid_date);
                const isDebt = !isPaidValid && bill.status !== 'Pemutihan' && bill.status !== 'Cancel' && bill.status !== 'Empty';
                
                if (isDebt && bill.received_date) {
                    const recDate = new Date(bill.received_date);
                    recDate.setHours(0, 0, 0, 0);
                    const ageDays = Math.floor((today - recDate) / (1000 * 60 * 60 * 24));

                    if (ageDays >= startAge && ageDays <= endAge) {
                        const colIndex = ageDays - startAge;
                        columnsData[colIndex].push({
                            clientId: client.id,
                            clientName: client.name,
                            contractNo: contract.no_kontrak,
                            contractId: contract.id_uniq, 
                            invoice: bill.invoice || 'No Inv',
                            amount: bill.amount,
                            age: ageDays,
                            service: contract.service_type,
                            hasContract: true 
                        });
                    }
                }
            });
        });

        // 2. DATA UNIDENTIFIED (Belum Punya Kontrak)
        if (client.unidentified && client.unidentified.length > 0) {
            client.unidentified.forEach(bill => {
                // Gunakan Tgl Terima jika ada, jika tidak pakai Tgl Terbit
                const refDateStr = bill.received_date || bill.date;
                
                if (refDateStr) { 
                    const refDate = new Date(refDateStr);
                    refDate.setHours(0,0,0,0);
                    const ageDays = Math.floor((today - refDate) / (1000 * 60 * 60 * 24));

                    if (ageDays >= startAge && ageDays <= endAge) {
                        const colIndex = ageDays - startAge;
                        
                        // LOGIKA ID CLIENT:
                        // Sistem backend (getAllData) sudah otomatis mengelompokkan orphan ke object client.
                        // Jadi kita bisa langsung pakai client.id ini.
                        
                        columnsData[colIndex].push({
                            clientId: client.id, // ID Client (misal: SV7F5)
                            clientName: client.name,
                            contractNo: '??? (Unidentified)',
                            contractId: '', // Kosongkan Contract ID
                            invoice: bill.invoice || 'No Inv',
                            amount: bill.amount,
                            age: ageDays,
                            service: 'Unknown',
                            hasContract: false 
                        });
                    }
                }
            });
        }
    });

    // RENDER HTML
    container.innerHTML = '';
    container.classList.remove('hidden');

    let hasData = false;

    for (let i = 0; i < 7; i++) {
        const currentAge = startAge + i;
        const billsInColumn = columnsData[i];
        const isTodayColumn = (i === 0);
        if (billsInColumn.length > 0) hasData = true;

        const headerColor = getAgeColor(currentAge); 

        const cardsHtml = billsInColumn.map(item => {
            // [UPDATE] Semua item sekarang memanggil goToClientFromAge
            // Parameter ke-2 (ContractID) dikirim kosong jika unidentified
            const clickAction = `goToClientFromAge('${item.clientId}', '${item.contractId || ''}')`;

            const bgStyle = item.hasContract ? 'background: white;' : 'background: #fff3e0; border: 1px dashed #ffb74d;';
            const iconStatus = item.hasContract ? '' : '<i class="ri-alert-line" style="color:orange; float:right;" title="Perlu Identifikasi"></i>';

            return `
            <div onclick="${clickAction}" style="${bgStyle} padding: 12px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); cursor: pointer; border-left: 3px solid ${headerColor}; transition: transform 0.1s;">
                <div style="font-size: 9px; color: #90a4ae; font-weight: 700; text-transform: uppercase; margin-bottom: 4px;">
                    ${item.service} ${iconStatus}
                </div>
                <div style="font-weight: 700; color: #37474f; font-size: 12px; line-height: 1.2; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${item.clientName}
                </div>
                <div style="display: flex; justify-content: space-between; align-items: flex-end;">
                    <div style="font-size: 11px; font-weight: 600; color: #263238;">${rp.format(item.amount)}</div>
                    <div style="font-size: 10px; color: #78909c;">${item.invoice}</div>
                </div>
            </div>
            `;
        }).join('');

        const columnHtml = `
            <div style="min-width: 260px; width: 260px; display: flex; flex-direction: column;">
                <div style="background: ${isTodayColumn ? '#37474f' : '#eceff1'}; color: ${isTodayColumn ? 'white' : '#546e7a'}; padding: 10px; border-radius: 6px 6px 0 0; font-weight: 700; font-size: 13px; text-align: center; border-bottom: 3px solid ${headerColor};">
                    UMUR ${currentAge} HARI
                    <div style="font-size: 10px; font-weight: normal; opacity: 0.8;">${billsInColumn.length} Tagihan</div>
                </div>
                
                <div style="background: #f5f7f8; padding: 10px; border-radius: 0 0 6px 6px; max-height: 65vh; overflow-y: auto;">
                    ${billsInColumn.length > 0 ? cardsHtml : '<div style="text-align:center; color:#cfd8dc; font-size:11px; padding-top:20px;">- Kosong -</div>'}
                </div>
            </div>
        `;
        container.innerHTML += columnHtml;
    }

    if (!hasData) {
        container.innerHTML = `<div style="width:100%; text-align: left; color: #ef5350; padding: 20px;">Tidak ditemukan data tagihan pada range umur ${startAge} s/d ${endAge} hari.</div>`;
    }
}

// === FUNGSI NAVIGASI PINTAR (IDENTIFIED VS UNIDENTIFIED) ===

function goToClientFromAge(clientId, contractId) {
    // 1. Buka Client yang sesuai (Berdasarkan ID Client / Prefix Invoice)
    selectClient(clientId, true);
    
    // 2. Cek apakah ada ID Kontrak?
    setTimeout(() => {
        if (contractId && contractId !== 'undefined' && contractId !== '') {
            // KONDISI A: DATA SUDAH KENAL (Punya Kontrak) -> Buka Detail Kontrak
            const contract = currentClient.contracts.find(c => c.id_uniq === contractId);
            if(contract) {
                openBillingDetail(contract.id_uniq, contract.service_type, contract.location);
            }
        } else {
            // KONDISI B: DATA BELUM KENAL (Unidentified) -> Buka Tab Unidentified
            // Panggil fungsi switchView('unknown') yang sudah ada
            if (typeof switchView === 'function') {
                switchView('unknown'); 
            } else {
                console.error("Fungsi switchView tidak ditemukan!");
            }
        }
    }, 150); // Beri jeda sedikit agar renderClientProfile selesai
}

function showUnidentifiedAlert(invoice, clientName) {
    alert(`PERINGATAN SISTEM:\n\nTagihan Invoice: ${invoice}\nClient: ${clientName}\n\nData ini belum memiliki 'Contract ID' yang valid (Unidentified).\nSilakan masuk ke menu detail client tersebut dan perbaiki data di tab 'Unidentified' (Tombol Oranye).`);
}

// === CLIENT PROFILE & CONTRACTS LOGIC ===

function renderClientProfile(client) {
    const container = document.getElementById('app-container');
    const metrics = calculateClientMetrics(client);
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    const totalVal = metrics.totalPaid + metrics.totalUnpaid;
    const paidPct = totalVal === 0 ? 0 : Math.round((metrics.totalPaid / totalVal) * 100);
    const unpaidPct = 100 - paidPct;
    
    const nextFuVal = client.next_fu ? formatDateInput(client.next_fu) : '';
    const paymentMethod = client.payment_method || ''; 
    const vaNumber = client.va_number || '';
    
    // [BARU] Ambil Preferensi PPh (Default No jika kosong)
    const pphPref = client.pph_pref || 'No'; 

    // Hitung Persentase Resiko (Bar)
    const totalRisks = metrics.totalUnpaidCount === 0 ? 1 : metrics.totalUnpaidCount;
    const badDebtPct = Math.round((metrics.badDebtCount / totalRisks) * 100);
    const overduePct = Math.round((metrics.overdueCount / totalRisks) * 100);
    const withinPct = Math.round((metrics.withinDueCount / totalRisks) * 100);

    const pieStyle = `background: conic-gradient(
        #00c853 0% ${paidPct}%, 
        #ef5350 ${paidPct}% 100%
    );`;

    document.body.classList.add('mode-fixed');

    const html = `
        <div class="detail-layout-wrapper">
            
            <div class="detail-fixed-header">
                <button onclick="navigate('ar_monitor')" style="margin-bottom:15px; border:none; background:none; color:#546e7a; cursor:pointer; font-weight:700; display:flex; align-items:center; gap:5px;">
                    <i class="ri-arrow-left-line"></i> Kembali
                </button>
                
                <div class="dark-client-card">
                    
                    <div class="dcc-col-left">
                        <div style="margin-bottom:10px;">
                            <h1 style="font-size:18px; color:var(--accent-teal); line-height:1.2; margin-bottom:2px;">${client.name}</h1>
                            <div style="font-size:11px; color:#64748b;">ID: ${client.id} | ${client.address||'Indonesia'}</div>
                        </div>

                        <div style="display:grid; gap:10px;">
                            <div><label style="font-size:10px; color:#64748b;">PIC CLIENT</label><input type="text" id="edit-pic" class="clean-input" value="${client.pic || ''}" placeholder="-"></div>
                            <div><label style="font-size:10px; color:#64748b;">TELEPON</label><input type="text" id="edit-phone" class="clean-input" value="${client.phone || ''}" placeholder="-"></div>
                            <div><label style="font-size:10px; color:#64748b;">EMAIL</label><input type="text" id="edit-email" class="clean-input" value="${client.email || ''}" placeholder="-"></div>
                            
                            <div>
                                <label style="font-size:10px; color:#64748b;">METODE PEMBAYARAN</label>
                                <select id="edit-payment-method" class="clean-input" style="color:${paymentMethod?'#fff':'#94a3b8'}; cursor:pointer;">
                                    <option value="" style="color:#333">-- Pilih --</option>
                                    <option value="VA Closed Payment" ${paymentMethod==='VA Closed Payment'?'selected':''} style="color:#333">VA Closed Payment</option>
                                    <option value="VA Open Payment" ${paymentMethod==='VA Open Payment'?'selected':''} style="color:#333">VA Open Payment</option>
                                    <option value="BNI 72 722 7222 5" ${paymentMethod==='BNI 72 722 7222 5'?'selected':''} style="color:#333">BNI 72 722 7222 5</option>
                                    <option value="BCA 4905600886" ${paymentMethod==='BCA 4905600886'?'selected':''} style="color:#333">BCA 4905600886</option>
                                    <option value="GIRO" ${paymentMethod==='GIRO'?'selected':''} style="color:#333">GIRO</option>
                                    <option value="CHECK" ${paymentMethod==='CHECK'?'selected':''} style="color:#333">CHECK</option>
                                    <option value="TUNAI/CASH" ${paymentMethod==='TUNAI/CASH'?'selected':''} style="color:#333">TUNAI/CASH</option>
                                </select>
                            </div>

                            <div style="background:rgba(0,200,83,0.1); padding:5px 8px; border-radius:4px; border-left:3px solid #00c853;">
                                <label style="font-size:9px; color:#00c853; font-weight:bold;">VIRTUAL ACCOUNT</label>
                                <input type="text" id="edit-va-number" value="${vaNumber}" placeholder="-" class="input-va-style">
                            </div>
                        </div>

                        <button onclick="saveClientInfo()" class="btn-save-dark">
                            <i class="ri-save-3-line"></i> SIMPAN PERUBAHAN
                        </button>
                    </div>

                    <div class="dcc-col-mid">
                        <div style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155;">
                            <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:5px;">NEXT FOLLOW UP</label>
                            <input type="date" id="edit-next-fu" value="${nextFuVal}" style="background:#1e293b; border:1px solid #475569; color:white; padding:5px; border-radius:4px; width:100%; font-size:12px;">
                        </div>

                        <div style="display:flex; align-items:center; gap:10px; padding:5px 0;">
                            <div style="background:#334155; width:35px; height:35px; display:flex; align-items:center; justify-content:center; border-radius:50%; color:#cbd5e1;">
                                <i class="ri-timer-flash-line"></i>
                            </div>
                            <div>
                                <div style="font-size:18px; font-weight:bold; color:white;">${metrics.avgPaymentDays} <span style="font-size:11px; font-weight:normal;">Hari</span></div>
                                <div style="font-size:10px; color:#94a3b8;">Rata-rata Bayar</div>
                            </div>
                        </div>

                        <div style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; margin-bottom:10px;">
                            <label style="font-size:10px; color:#94a3b8; display:block; margin-bottom:8px; font-weight:bold; letter-spacing:0.5px;">PREFERENSI PEMBAYARAN:</label>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                <label style="cursor:pointer; display:flex; align-items:center; gap:8px; color:white; font-size:12px;">
                                    <input type="radio" name="pph_pref" value="No" ${pphPref !== 'Yes' ? 'checked' : ''} style="accent-color: var(--accent-teal);"> 
                                    <span>Full Payment (Utuh)</span>
                                </label>
                                <label style="cursor:pointer; display:flex; align-items:center; gap:8px; color:white; font-size:12px;">
                                    <input type="radio" name="pph_pref" value="Yes" ${pphPref === 'Yes' ? 'checked' : ''} style="accent-color: var(--accent-red);"> 
                                    <span>Potong PPh 23 (2%)</span>
                                </label>
                            </div>
                        </div>

                        <div class="action-btn-grid">
                            <button class="btn-action-primary" onclick="openFollowUpModal()">
                                <i class="ri-chat-history-line" style="color:#fbbf24;"></i> Catat Follow Up
                            </button>
                            <button class="btn-action-primary" onclick="openReminderModal()">
                                <i class="ri-whatsapp-line" style="color:#4ade80;"></i> Kirim WA Reminder
                            </button>
                            <button class="btn-action-primary" onclick="openSKTModal()">
                                <i class="ri-file-pdf-line" style="color:#f472b6;"></i> Buat Surat (SKT)
                            </button>
                        </div>
                    </div>

                    <div class="dcc-col-right">
                        <div class="pie-chart-section">
                            <div class="pie-chart-wrapper" style="${pieStyle}"></div>
                            <div class="chart-legend-box">
                                <div class="legend-row"><div class="dot-indicator" style="background:#00c853;"></div><span>PAID: <b>${paidPct}%</b></span></div>
                                <div class="legend-row"><div class="dot-indicator" style="background:#ef5350;"></div><span>UNPAID: <b>${unpaidPct}%</b></span></div>
                            </div>
                        </div>

                        <div class="right-stats-wrapper">
                            <div class="risk-section">
                                <div style="font-size:11px; color:#94a3b8; text-transform:uppercase; font-weight:700; margin-bottom:5px;">Resiko Piutang</div>
                                <div class="risk-row" onclick="openRiskModal('BadDebt')">
                                    <div class="risk-header"><span>Bad Debt (>60 Hari)</span> <strong style="color:#ef5350">${metrics.badDebtCount}</strong></div>
                                    <div class="p-bar-bg"><div class="p-bar-fill" style="width:${badDebtPct}%; background:#ef5350;"></div></div>
                                </div>
                                <div class="risk-row" onclick="openRiskModal('Overdue')">
                                    <div class="risk-header"><span>Overdue (30-59 Hari)</span> <strong style="color:#ffca28">${metrics.overdueCount}</strong></div>
                                    <div class="p-bar-bg"><div class="p-bar-fill" style="width:${overduePct}%; background:#ffca28;"></div></div>
                                </div>
                                <div class="risk-row" onclick="openRiskModal('WithinDue')">
                                    <div class="risk-header"><span>Within Due (<30 Hari)</span> <strong style="color:#42a5f5">${metrics.withinDueCount}</strong></div>
                                    <div class="p-bar-bg"><div class="p-bar-fill" style="width:${withinPct}%; background:#42a5f5;"></div></div>
                                </div>
                            </div>

                            <div class="status-section">
                                <div style="font-size:11px; color:#94a3b8; text-transform:uppercase; font-weight:700; margin-bottom:5px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:10px;">Rincian Status</div>
                                <div class="status-grid">
                                    <div class="status-card sc-red" onclick="openRiskModal('Unpaid')"><div class="sc-title">UNPAID (HUTANG)</div><div class="sc-value">${metrics.countUnpaid} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                    <div class="status-card sc-green" onclick="openRiskModal('Paid')"><div class="sc-title">PAID (LUNAS)</div><div class="sc-value">${metrics.countPaid} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                    <div class="status-card sc-grey" onclick="openRiskModal('Cancel')"><div class="sc-title">CANCEL</div><div class="sc-value">${metrics.countCancel} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                    <div class="status-card sc-dark" onclick="openRiskModal('Putus')"><div class="sc-title">PUTUS</div><div class="sc-value">${metrics.countPutus} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                    <div class="status-card sc-purple" onclick="openRiskModal('Dispute')"><div class="sc-title">DISPUTE</div><div class="sc-value">${metrics.countDispute} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                    <div class="status-card sc-blue" onclick="openRiskModal('Pemutihan')"><div class="sc-title">WRITE-OFF</div><div class="sc-value">${metrics.countPemutihan} <span style="font-size:10px; font-weight:normal;">Inv</span></div></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section-title">
                    <span>Daftar Kontrak & Tagihan</span>
                    <div class="view-toggles">
                        <button class="${viewMode==='grid'?'active':''}" onclick="switchView('grid')">Kontrak</button>
                        <button class="${viewMode==='list'?'active':''}" onclick="switchView('list')">Rekonsiliasi</button>
                        <button class="${viewMode==='unknown'?'active':''} ${client.unidentified?.length>0?'btn-blink':''}" onclick="switchView('unknown')" style="${client.unidentified?.length>0?'':'background:#ef6c00; color:white; border:none;'}">
                    ${client.unidentified?.length>0 ? 'Unidentified ('+client.unidentified.length+')' : 'Unidentified'}
                        </button>
                        <button onclick="openClientGroupView()" class="btn-members">
                         <i class="ri-team-line"></i> Members
                        </button>
                        </div>
                    </div>
                    </div>

            <div class="detail-scrollable-content">
                <div id="contracts-container"></div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
    renderContracts(document.getElementById('contracts-container'));
}

function calculateClientMetrics(client) {
    let totalPaid = 0;
    let totalUnpaid = 0;
    let badDebtCount = 0;
    let overdueCount = 0;
    let withinDueCount = 0; 
    let disputeCount = 0;
    let totalUnpaidCount = 0;
    let totalPayDays = 0;
    let payCount = 0;
    
    // --- COUNTER BARU ---
    let countCancel = 0;
    let countPutus = 0;
    let countPemutihan = 0; // Write-Off
    let countDispute = 0;
    let countPaid = 0;
    let countUnpaid = 0;

    const today = new Date();

    client.contracts.forEach(c => {
        c.billings.forEach(b => {
            const isReallyPaid = (b.status === 'Paid' && b.paid_date);
            const isPemutihan = (b.status === 'Pemutihan');
            const status = b.status;

            // Hitung Status Spesifik
            if (status === 'Cancel') countCancel++;
            else if (status === 'Putus') countPutus++;
            else if (status === 'Pemutihan') countPemutihan++;
            else if (status === 'Dispute') countDispute++;
            
            if (isReallyPaid) {
                countPaid++;
                const rec = new Date(b.received_date);
                const pd = new Date(b.paid_date);
                if(b.received_date && b.paid_date) {
                    const diff = Math.ceil((pd - rec) / (1000 * 60 * 60 * 24));
                    if(diff >= 0) {
                        totalPayDays += diff;
                        payCount++;
                    }
                }
                totalPaid += b.amount;
            } else if (!isReallyPaid && !isPemutihan && (status === 'Unpaid' || status === 'Dispute' || status === 'Paid')) {
                // Logic Unpaid / Hutang
                countUnpaid++;
                totalUnpaid += b.amount;
                totalUnpaidCount++;
                
                if (b.received_date) {
                    const diffDays = Math.ceil(Math.abs(today - new Date(b.received_date)) / (1000 * 60 * 60 * 24));
                    if (diffDays > 60) badDebtCount++;
                    else if (diffDays >= 30) overdueCount++;
                    else withinDueCount++; 
                } else {
                    withinDueCount++; 
                }
            }
        });
    });

    const avgPaymentDays = payCount > 0 ? Math.round(totalPayDays / payCount) : 0;
    
    return { 
        totalPaid, totalUnpaid, badDebtCount, overdueCount, withinDueCount, 
        disputeCount, totalUnpaidCount, avgPaymentDays,
        // Return counter baru
        countCancel, countPutus, countPemutihan, countDispute, countPaid, countUnpaid 
    };
}

function switchView(mode) {
    viewMode = mode;
    saveAppState();
    renderClientProfile(currentClient); 
}

function renderContracts(container) {
    if(viewMode === 'grid') {
        container.className = 'contracts-grid';
        renderContractsGrid(container);
    } else if (viewMode === 'list') {
        container.className = 'billing-container';
        renderContractsList(container);
    } else if (viewMode === 'unknown') {
        // Mode Baru untuk Data Tanpa Kontrak
        container.className = 'billing-container';
        renderUnidentifiedBills(container);
    }
}


// ============================================================
// FUNGSI RENDER UNIDENTIFIED (LOGIKA BARU: DELETE DUPLICATE & REVISI)
// ============================================================

// ============================================================
// FUNGSI RENDER UNIDENTIFIED (UPDATE: ADD NEW CONTRACT BUTTON)
// ============================================================

// ============================================================
// FUNGSI RENDER UNIDENTIFIED (UPDATE: LOGIKA DEDUPLIKASI TANGGAL)
// ============================================================

function renderUnidentifiedBills(container) {
    const orphans = currentClient.unidentified || [];
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    // --- EMPTY STATE ---
    if (orphans.length === 0) {
        container.innerHTML = `
            <div style="padding: 60px 20px; text-align: center; color: #90a4ae; background:white; border-radius:12px; border:1px dashed #cfd8dc;">
                <div style="background:#e0f2f1; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 15px auto;">
                    <i class="ri-check-double-line" style="font-size: 32px; color:#00695c;"></i>
                </div>
                <h3 style="color:#37474f; font-size:16px; margin-bottom:5px;">Data Bersih (Clean)</h3>
                <p style="font-size:13px;">Semua tagihan sudah teridentifikasi ke dalam kontrak.</p>
            </div>`;
        return;
    }

    // --- 1. LOGIKA PRE-SCAN: DETEKSI KEMBAR INTERNAL (SESAMA UNIDENTIFIED) ---
    // Kita cari invoice yang sama di dalam list orphans sendiri
    const invoiceMap = {};
    const obsoleteIndices = new Set(); // Menyimpan index yang harus di-DELETE (Versi Tua)

    // Grouping berdasarkan Invoice
    orphans.forEach((b, idx) => {
        const inv = String(b.invoice).trim().toUpperCase();
        if (!invoiceMap[inv]) invoiceMap[inv] = [];
        invoiceMap[inv].push({ ...b, originalIdx: idx });
    });

    // Tentukan Pemenang (Tanggal Muda) vs Kalah (Tanggal Tua)
    Object.keys(invoiceMap).forEach(inv => {
        const group = invoiceMap[inv];
        if (group.length > 1) {
            // Sort Descending (Terbaru ke Terlama)
            group.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            // Item pertama (index 0) adalah yang TERBARU (Keep/Save)
            // Item sisanya (index 1 ke atas) adalah VERSI LAMA (Delete)
            for (let i = 1; i < group.length; i++) {
                obsoleteIndices.add(group[i].originalIdx);
            }
        }
    });

    // --- HEADER DASHBOARD ---
    let html = `
        <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%); padding:20px; border-radius:12px 12px 0 0; border-bottom:1px solid #ffcc80; display:flex; align-items:center; gap:15px;">
            <div style="background:white; width:45px; height:45px; border-radius:8px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(230,81,0,0.2);">
                <i class="ri-git-merge-line" style="font-size:24px; color:#ef6c00;"></i>
            </div>
            <div>
                <strong style="color:#e65100; font-size:15px; display:block;">SMART GAP & DUPLICATE DETECTION</strong>
                <span style="font-size:12px; color:#f57c00;">
                    Sistem mendeteksi <b>${orphans.length} tagihan</b> yang perlu perhatian Anda.
                </span>
            </div>
            
             <div style="margin-left: auto;">
                <button onclick="openNewContractModal()" style="background: white; color: #e65100; border: none; padding: 8px 15px; border-radius: 50px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 6px; font-size: 12px; transition: transform 0.2s;">
                    <i class="ri-add-circle-fill" style="font-size: 16px;"></i> Input Kontrak Baru
                </button>
            </div>
        </div>
        
        <div style="overflow-x:auto; background:white; border-radius:0 0 12px 12px; box-shadow:0 4px 15px rgba(0,0,0,0.05);">
        <table class="erp-table" style="margin:0;">
            <thead style="background:#fcfdfe;">
                <tr>
                    <th style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c;">DOKUMEN</th>
                    <th style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c;">NILAI & TANGGAL</th>
                    <th style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c;">DIAGNOSA SISTEM</th>
                    <th width="35%" style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c;">PREDIKSI KONTRAK & LOKASI</th>
                    <th width="18%" style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c;">SET PERIODE</th>
                    <th width="8%" style="padding:15px 20px; font-size:11px; letter-spacing:0.5px; color:#78909c; text-align:center;">AKSI</th>
                </tr>
            </thead>
            <tbody>
    `;

    orphans.forEach((b, idx) => {
        // --- 2. LOGIKA UTAMA RENDER ROW ---
        let existingBill = null;
        let existingContract = null;
        
        // Cek conflict dengan database (Kontrak Aktif)
        for (const c of currentClient.contracts) {
            const found = c.billings.find(x => 
                x.invoice && String(x.invoice).trim().toLowerCase() === String(b.invoice).trim().toLowerCase() && 
                x.status !== 'Empty' && !x.isGhost
            );
            if (found) { existingBill = found; existingContract = c; break; }
        }

        // Tentukan Mode Baris
        let rowMode = 'NORMAL';
        let statusBadge = `<span style="background:#e0f7fa; color:#006064; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:700; border:1px solid #b2ebf2;"><i class="ri-asterisk"></i> DATA BARU</span>`;
        let rowBg = '#ffffff'; 
        
        let suggestedContractId = '';
        let defaultPeriod = '';
        let warningText = '';

        // --- A. PRIORITAS 1: CEK INTERNAL DUPLICATE (LOGIKA BARU) ---
        if (obsoleteIndices.has(idx)) {
            // Ini adalah versi TUA/SALAH karena ada versi yang lebih baru di list yang sama
            rowMode = 'OBSOLETE'; // Mode baru untuk delete internal
            statusBadge = `<span style="background:#fff3e0; color:#e65100; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:700; border:1px solid #ffcc80;"><i class="ri-history-line"></i> VERSI LAMA</span>`;
            rowBg = '#fff8e1'; // Kuning warning
        }
        // --- B. PRIORITAS 2: CEK DATABASE DUPLICATE ---
        else if (existingBill) {
            const existFP = String(existingBill.faktur || '').trim().replace(/[^0-9]/g, '');
            const newFP = String(b.faktur || '').trim().replace(/[^0-9]/g, '');

            if (existFP === newFP) {
                rowMode = 'DUPLICATE';
                statusBadge = `<span style="background:#ffebee; color:#c62828; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:700; border:1px solid #ffcdd2;"><i class="ri-error-warning-line"></i> DUPLIKAT DB</span>`;
                rowBg = '#fff5f5'; 
            } else {
                rowMode = 'REVISION';
                statusBadge = `<span style="background:#e3f2fd; color:#1565c0; padding:4px 8px; border-radius:6px; font-size:10px; font-weight:700; border:1px solid #bbdefb;"><i class="ri-refresh-line"></i> REVISI FP</span>`;
                rowBg = '#f5f9ff'; 
                
                suggestedContractId = existingContract.id_uniq;
                const dExist = new Date(existingBill.period); 
                if(!isNaN(dExist.getTime())) {
                    const yyyy = dExist.getFullYear();
                    const mm = String(dExist.getMonth() + 1).padStart(2, '0');
                    defaultPeriod = `${yyyy}-${mm}`; 
                    warningText = `<span style="color:#1565c0; font-weight:600; font-size:10px;"><i class="ri-corner-down-right-line"></i> Update: ${existingBill.period}</span>`;
                }
            }
        }

        // --- BUILD DROPDOWN ---
        let suggestionHtml = '<option value="">-- Pilih Kontrak Manual --</option>';
        
        // Dropdown dimatikan jika mode Delete (Duplicate/Obsolete)
        if (rowMode !== 'DUPLICATE' && rowMode !== 'OBSOLETE') { 
            currentClient.contracts.forEach(c => {
                let isMatch = false;
                if (rowMode === 'REVISION') {
                    isMatch = (c.id_uniq === suggestedContractId);
                } else {
                    const estMonthlyTotal = Math.round((c.nilai / (c.duration || 12)) * 1.11);
                    isMatch = Math.abs(estMonthlyTotal - b.amount) < 5000;
                    if (isMatch && !suggestedContractId) suggestedContractId = c.id_uniq;
                }
                
                const statusIcon = c.is_active ? '🟢' : '🔴';
                const selected = isMatch ? 'selected' : '';
                const matchText = isMatch ? '⭐ MATCH' : '';
                const fullLocation = c.location || 'Lokasi tidak diset';
                const safeLocation = fullLocation.replace(/"/g, '&quot;');
                const style = isMatch ? 'font-weight:bold; color:#1b5e20; background:#e8f5e9;' : 'color:#546e7a;';
                const estVal = Math.round((c.nilai / (c.duration || 12)) * 1.11); 

                suggestionHtml += `<option value="${c.id_uniq}" data-service="${c.service_type}" data-location="${safeLocation}" ${selected} style="${style}">
                                    ${statusIcon} ${c.no_kontrak} - ${rp.format(estVal)} - ${fullLocation} ${matchText}
                                   </option>`;
            });
        }

        // --- PREDIKSI PERIODE (SMART GAP) ---
        if ((rowMode === 'NORMAL' || rowMode === 'REVISION') && suggestedContractId && b.date) {
            const orphanDate = new Date(b.date);
            const targetContract = currentClient.contracts.find(c => c.id_uniq === suggestedContractId);
            
            if (targetContract) {
                const validBills = targetContract.billings.filter(x => x.date && !x.isGhost && x.status !== 'Empty')
                                  .sort((p1, p2) => new Date(p1.date) - new Date(p2.date));
                let targetDateObj = null;
                
                if (validBills.length === 0) { 
                    targetDateObj = orphanDate; 
                } else {
                    if (orphanDate < new Date(validBills[0].date)) {
                        const firstPeriod = new Date(validBills[0].period); firstPeriod.setMonth(firstPeriod.getMonth() - 1); 
                        targetDateObj = firstPeriod;
                    } else if (orphanDate > new Date(validBills[validBills.length - 1].date)) {
                        const lastPeriod = new Date(validBills[validBills.length - 1].period); lastPeriod.setMonth(lastPeriod.getMonth() + 1); 
                        targetDateObj = lastPeriod;
                        warningText = `<span style="color:#2e7d32; font-size:10px;"><i class="ri-arrow-right-line"></i> Lanjut ${validBills[validBills.length - 1].periodDisplay}</span>`;
                    }
                }
                if (targetDateObj) {
                    const yyyy = targetDateObj.getFullYear();
                    const mm = String(targetDateObj.getMonth() + 1).padStart(2, '0');
                    defaultPeriod = `${yyyy}-${mm}`;
                }
            }
        }
        if (!defaultPeriod && b.date) {
             const d = new Date(b.date);
             defaultPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }

        // --- TOMBOL AKSI & KONTROL ---
        let actionButton = '';
        let inputControls = '';

        // TAMPILAN UNTUK YANG HARUS DIHAPUS (Duplicate DB atau Obsolete Internal)
        if (rowMode === 'DUPLICATE' || rowMode === 'OBSOLETE') {
            const reason = rowMode === 'DUPLICATE' ? 
                `Data Valid sudah ada: ${existingContract?.no_kontrak}` : 
                `Ada invoice sama dengan tanggal lebih baru (Revisi)`;

            inputControls = `
                <div style="background:${rowBg}; padding:10px; border-radius:6px; border:1px dashed #ef5350;">
                    <div style="font-size:11px; color:#c62828; font-weight:600;">Sistem Menolak:</div>
                    <div style="font-size:10px; color:#546e7a;">${reason}</div>
                    <div style="font-size:10px; color:#90a4ae; margin-top:2px;">Item ini harus dihapus.</div>
                </div>`;
            
            actionButton = `
                <button onclick="deleteOrphan('${b.invoice}', ${idx})" 
                        style="background:white; color:#c62828; border:1px solid #ef5350; border-radius:6px; width:36px; height:36px; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(0,0,0,0.05); transition:0.2s;" title="Hapus Data">
                    <i class="ri-delete-bin-line" style="font-size:16px;"></i>
                </button>`;
        } else {
            // TAMPILAN NORMAL / REVISI (SAVE)
            inputControls = `
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:5px;">
                    <div style="flex:1; position:relative;">
                        <i class="ri-building-line" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#90a4ae; font-size:12px;"></i>
                        <select id="fix-contract-${idx}" class="form-input" style="padding-left:30px; font-size:12px; border-color:#cfd8dc; background:#fff;">
                            ${suggestionHtml}
                        </select>
                    </div>
                    <button onclick="previewContractByRow(${idx})" title="Lihat Isi Kontrak" 
                        style="background:white; border:1px solid #b0bec5; color:#546e7a; border-radius:4px; padding:0 8px; height:34px; cursor:pointer; display:flex; align-items:center;">
                        <i class="ri-eye-line"></i>
                    </button>
                </div>
            `;
            
            const btnColor = rowMode === 'REVISION' ? '#0277bd' : '#ef6c00'; 
            const btnIcon = rowMode === 'REVISION' ? 'ri-save-2-line' : 'ri-save-3-line';
            const btnTitle = rowMode === 'REVISION' ? 'UPDATE DATA' : 'SIMPAN DATA';
            const btnLabel = rowMode === 'REVISION' ? 'UPD' : 'SAVE';
            
            actionButton = `
                <button onclick="saveUnidentified('${b.invoice}', ${idx})" 
                        style="background:${btnColor}; color:white; border:none; border-radius:6px; width:100%; height:36px; cursor:pointer; font-weight:bold; font-size:11px; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1);" title="${btnTitle}">
                    <i class="${btnIcon}" style="font-size:14px;"></i> ${btnLabel}
                </button>`;
        }

        // RENDER ROW HTML
        html += `
            <tr id="row-orphan-${idx}" style="background:${rowBg}; border-bottom:1px solid #f1f3f4;">
                <td style="vertical-align:middle;">
                    <div style="font-weight:700; color:#37474f; font-size:13px;">${b.invoice}</div>
                    <div style="font-size:11px; color:#78909c; margin-top:2px; font-family:monospace;">${b.faktur || '<span style="color:#cfd8dc">Tanpa FP</span>'}</div>
                </td>
                <td style="vertical-align:middle;">
                    <div style="font-weight:800; color:#263238; font-size:13px;">${rp.format(b.amount)}</div>
                    <div style="font-size:11px; color:#546e7a; margin-top:2px;">
                        <i class="ri-calendar-line" style="font-size:10px; margin-right:2px;"></i> ${b.date ? formatDate(b.date) : '-'}
                    </div>
                </td>
                <td style="vertical-align:middle;">
                    ${statusBadge}
                </td>
                
                <td style="vertical-align:middle;">
                    ${inputControls}
                </td>

                <td style="vertical-align:middle;">
                    ${(rowMode !== 'DUPLICATE' && rowMode !== 'OBSOLETE') ? `
                        <input type="month" id="fix-period-${idx}" class="form-input" value="${defaultPeriod}" style="font-size:12px; font-weight:bold; color:#37474f; border-color:#cfd8dc;">
                        <div style="margin-top:4px;">${warningText}</div>
                    ` : '<span style="font-size:11px; color:#ccc;">-</span>'}
                </td>

                <td style="vertical-align:middle; text-align:center;">
                    ${actionButton}
                </td>
            </tr>`;
    });

    container.innerHTML = html + '</tbody></table></div>';
}

// === FUNGSI DELETE ORPHAN (Pastikan fungsi ini ada di script.js Anda) ===
function deleteOrphan(invoiceNo, idx) {
    if(!confirm(`⚠️ PENTING: Yakin ingin MENGHAPUS data duplikat ini?\n\nInvoice: ${invoiceNo}\n\nSistem akan menghapus baris Unidentified (Sampah) dan MEMPERTAHANKAN data valid yang sudah ada di kontrak.`)) return;

    // UI Loading
    const btn = document.querySelector(`#row-orphan-${idx} button`);
    if(btn) {
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Hapus...';
        btn.disabled = true;
    }

    const payload = {
        action: 'delete_billing',
        invoice: invoiceNo
    };

    sendData(payload);
}

// ===========================================
// FUNGSI BARU: DELETE ORPHAN (TOMBOL HAPUS)
// ===========================================
function deleteOrphan(invoiceNo, idx) {
    if(!confirm(`Yakin ingin MENGHAPUS data kembar (Duplikat) untuk Invoice: ${invoiceNo}?\nData ini akan dihapus permanen dari Sheet Billings.`)) return;

    // UI Loading
    const btn = document.querySelector(`#row-orphan-${idx} button`);
    if(btn) {
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Hapus...';
        btn.disabled = true;
    }

    const payload = {
        action: 'delete_billing',
        invoice: invoiceNo
    };

    sendData(payload);
}

// ===========================================
// FUNGSI SAVE/UPDATE UNIDENTIFIED (PERBAIKAN DATA UPDATE)
// ===========================================
function saveUnidentified(invoiceNo, idx) {
    const contractSelect = document.getElementById(`fix-contract-${idx}`);
    const periodInput = document.getElementById(`fix-period-${idx}`);
    
    // Ambil Data Sumber dari object unidentified
    const bill = currentClient.unidentified[idx];

    const newContractId = contractSelect.value;
    
    // Ambil atribut data dari opsi terpilih
    const selectedOption = contractSelect.options[contractSelect.selectedIndex];
    const newServiceType = selectedOption.getAttribute('data-service');
    const newLocation = selectedOption.getAttribute('data-location'); 

    const newPeriod = periodInput.value; // Format: YYYY-MM

    if (!newContractId || !newPeriod) {
        alert("Harap pilih Kontrak dan Periode!");
        return;
    }

    // 1. Parsing Input Periode (Target)
    const [yyyyStr, mmStr] = newPeriod.split('-');
    const targetYear = parseInt(yyyyStr);
    const targetMonth = parseInt(mmStr) - 1; // JS Month mulai dari 0 (Jan) s/d 11 (Des)
    
    // String periode untuk display/kirim
    const inputDate = new Date(targetYear, targetMonth, 1);
    const periodStr = inputDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // === VALIDASI KETAT DI FRONTEND ===
    const targetContract = currentClient.contracts.find(c => c.id_uniq === newContractId);
    
    if (targetContract) {
        // A. Cek Tabrakan Data (Conflict Check)
        // Loop semua billing yang ada di kontrak ini (Data Real)
        const conflictBill = targetContract.billings.find(b => {
            if (!b.period) return false;
            
            // Parsing tanggal dari data billing eksisting
            const bDate = new Date(b.period);
            if (isNaN(bDate.getTime())) return false; // Skip jika format tanggal invalid
            
            // Cek apakah Tahun & Bulan sama persis?
            return bDate.getFullYear() === targetYear && bDate.getMonth() === targetMonth;
        });

        if (conflictBill && !conflictBill.isGhost && conflictBill.status !== 'Empty') {
            // Normalisasi Invoice untuk perbandingan (Hilangkan spasi, uppercase)
            const oldInv = String(conflictBill.invoice || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const newInv = String(invoiceNo || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

            // JIKA Invoice Lama Ada isinya DAN Berbeda dengan Invoice Baru -> TOLAK MUTLAK
            if (oldInv.length > 3 && oldInv !== newInv) {
                alert(`⛔ AKSES DITOLAK: PERIODE SUDAH TERISI!\n\nPeriode: ${periodStr}\nSudah ada Invoice: ${conflictBill.invoice}\nInvoice Anda: ${invoiceNo}\n\nSistem MENOLAK menimpa data valid dengan Invoice berbeda.\nSilakan pilih periode lain yang masih kosong.`);
                return; // STOP PROSES
            }
        }

        // B. Cek Rentang Kontrak (Start - End)
        if (targetContract.start_date && targetContract.end_date) {
            const startDate = new Date(targetContract.start_date); startDate.setDate(1); startDate.setHours(0,0,0,0);
            const endDate = new Date(targetContract.end_date); endDate.setDate(1); endDate.setHours(0,0,0,0);
            
            // Set inputDate ke tanggal 1 agar adil
            inputDate.setDate(1); inputDate.setHours(0,0,0,0);

            if (inputDate < startDate || inputDate > endDate) {
                const fmtStart = startDate.toLocaleDateString('id-ID', {month:'long', year:'numeric'});
                const fmtEnd = endDate.toLocaleDateString('id-ID', {month:'long', year:'numeric'});
                alert(`⛔ PERIODE DITOLAK (DILUAR KONTRAK)!\n\nKontrak ${targetContract.no_kontrak} hanya berlaku:\n${fmtStart} s/d ${fmtEnd}`);
                return; 
            }
        }
    }

    if(!confirm(`Simpan/Update Invoice ${invoiceNo} ke:\nKontrak: ${targetContract ? targetContract.no_kontrak : newContractId}\nPeriode: ${periodStr}?`)) return;

    // UI Loading
    const btn = document.querySelector(`#row-orphan-${idx} button`);
    if(btn) {
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
        btn.disabled = true;
    }

    const payload = {
        action: 'fix_orphan_data', 
        invoice: invoiceNo,
        contract_id: newContractId,
        period: periodStr,
        service_type: newServiceType,
        location: newLocation,
        faktur: bill.faktur || '',
        amount: bill.amount || 0,
        date: bill.date || '',
        received_date: bill.received_date || ''
    };

    sendData(payload);
}

function previewContractByRow(idx) {
    // 1. Ambil ID Kontrak dari Dropdown baris tersebut
    const dropdown = document.getElementById(`fix-contract-${idx}`);
    const contractId = dropdown.value;

    if (!contractId) {
        alert("Pilih kontrak terlebih dahulu!");
        return;
    }

    // 2. Cari Data Kontrak
    const contract = currentClient.contracts.find(c => c.id_uniq === contractId);
    if (!contract) return;

    // 3. GENERATE FULL DATA (Gabungan Data Existing + Bulan Kosong/Ghost)
    // Ini kuncinya agar semua bulan muncul
    const fullBillings = generateFullDurationBillings(contract);

    // 4. Format Tanggal Periode Kontrak
    const fmtDateLong = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';
    const periodRange = `<span style="color:#e65100; font-weight:bold;">${fmtDateLong(contract.start_date)}</span> s/d <span style="color:#e65100; font-weight:bold;">${fmtDateLong(contract.end_date)}</span>`;

    // 5. Render Modal
    const modal = document.getElementById('risk-modal'); 
    const title = document.getElementById('risk-modal-title');
    const container = document.getElementById('risk-list-container');
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    title.innerHTML = `<i class="ri-file-search-line"></i> Preview Isi Kontrak <br><span style="font-size:12px; color:#ccc; font-weight:normal;">${contract.no_kontrak} (${contract.service_type})</span>`;

    // Header Tabel Preview
    let tableHtml = `
        <div style="margin-bottom:15px; background:#fff3e0; padding:10px; border-radius:6px; border:1px solid #ffe0b2; font-size:12px; color:#546e7a;">
            <div style="margin-bottom:5px;">PERIODE KONTRAK: ${periodRange}</div>
            <div>
                Berikut adalah simulasi urutan bulan. Cari bulan yang statusnya <span style="background:#fff; border:1px solid #ccc; padding:0 4px; font-weight:bold;">KOSONG</span> untuk mengisi data.
            </div>
        </div>
        <table class="erp-table" style="font-size:11px;">
            <thead>
                <tr>
                    <th>Periode</th>
                    <th>Status</th>
                    <th>Invoice</th>
                    <th>Tanggal Terbit</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Loop data FULL (bukan cuma yang ada isinya)
    fullBillings.forEach(b => {
        // Style status
        let statusStyle = 'color:#546e7a; font-weight:normal;';
        let statusText = '-';
        let rowBg = '';
        let invText = b.invoice || '-';
        let dateText = b.date ? formatDate(b.date) : '-';

        if (b.status === 'Paid') {
            statusStyle = 'color:#2e7d32; font-weight:bold;';
            statusText = 'LUNAS';
            rowBg = 'background:#e8f5e9;'; // Hijau muda
        } else if (b.status === 'Unpaid' || b.status === 'Dispute') {
            statusStyle = 'color:#c62828; font-weight:bold;';
            statusText = b.status.toUpperCase();
            rowBg = 'background:#ffebee;'; // Merah muda
        } else if (b.status === 'Empty' || b.isGhost) {
            statusText = 'KOSONG'; // Penanda Gap
            statusStyle = 'color:#bdbdbd; font-weight:bold; font-style:italic;';
            invText = '<span style="color:#eee;">-</span>';
            dateText = '<span style="color:#eee;">-</span>';
            rowBg = ''; // Putih
        } else {
            statusText = b.status; // Cancel, Putus, dll
        }

        tableHtml += `
            <tr style="${rowBg}">
                <td style="font-weight:bold;">${b.periodDisplay || formatPeriod(b.period)}</td>
                <td style="${statusStyle}">${statusText}</td>
                <td>${invText}</td>
                <td>${dateText}</td>
            </tr>
        `;
    });

    tableHtml += `</tbody></table>`;
    
    tableHtml += `<div style="text-align:right; margin-top:15px;"><button onclick="closeRiskModal()" style="background:#546e7a; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer;">Tutup Preview</button></div>`;

    container.innerHTML = tableHtml;
    modal.classList.remove('hidden');
}

// ==========================================
// FIX 2: TAMPILAN KARTU KONTRAK (GROUPING)
// ==========================================

// ============================================================
// UPDATE: RENDER GRID KONTRAK (BUTTON ACTION KE MASTER DETAIL)
// ============================================================

function renderContractsGrid(container) {
    if (!currentClient || !currentClient.contracts || currentClient.contracts.length === 0) {
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#90a4ae;"><i class="ri-file-shred-line" style="font-size:30px;"></i><br>Tidak ada kontrak aktif.</div>';
        return;
    }

    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    const fmt = (d) => d ? new Date(d).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }) : '-';
    
    // 1. Lakukan Grouping berdasarkan No Kontrak
    const grouped = {};
    
    currentClient.contracts.forEach(c => {
        const key = c.no_kontrak ? c.no_kontrak.trim() : ('UNK_' + c.id_uniq);
        
        if (!grouped[key]) {
            grouped[key] = {
                // Simpan ID utama & lokasi pertama untuk parameter fungsi openBillingDetail
                mainId: c.id_uniq, 
                mainService: c.service_type,
                mainLocation: c.location,
                
                no_kontrak: c.no_kontrak,
                service_type: c.service_type,
                start_date: c.start_date,
                end_date: c.end_date,
                is_active: c.is_active,
                locations: [],
                totalValue: 0,
                riskStatus: { red: false, yellow: false, green: true }
            };
        }
        
        grouped[key].locations.push(c.location || '-');
        
        let cleanVal = String(c.nilai).replace(/[^0-9]/g, '');
        grouped[key].totalValue += parseInt(cleanVal || 0);

        // Cek Risiko
        const today = new Date();
        c.billings.forEach(b => {
            const isDebt = (b.status !== 'Paid' && b.status !== 'Pemutihan' && b.status !== 'Cancel' && b.status !== 'Empty');
            if (isDebt) {
                if (b.status === 'Dispute') {
                    grouped[key].riskStatus.yellow = true; grouped[key].riskStatus.green = false;
                } else if (b.received_date) {
                    const days = Math.ceil(Math.abs(today - new Date(b.received_date)) / 86400000);
                    if (days > 60) { grouped[key].riskStatus.red = true; grouped[key].riskStatus.green = false; }
                    else if (days >= 30) { grouped[key].riskStatus.yellow = true; grouped[key].riskStatus.green = false; }
                }
            }
        });
    });

    // 2. Render Kartu
    const html = Object.values(grouped).map(group => {
        const { red, yellow, green } = group.riskStatus;
        const showYellow = yellow && !red;

        const locList = group.locations.map(l => 
            `<div style="font-size:11px; color:#455a64; padding:2px 0; border-bottom:1px dashed #f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                <i class="ri-map-pin-line" style="font-size:10px;"></i> ${l}
            </div>`
        ).join('');

        // [UPDATE PENTING] Tombol sekarang memanggil openBillingDetail
        // Kita kirim parameter ID, Service, dan Lokasi dari data 'main' group tersebut
        const safeLoc = group.mainLocation ? group.mainLocation.replace(/"/g, '&quot;').replace(/'/g, "\\'") : '';
        
        return `
        <div class="contract-card ${group.is_active ? 'active' : 'expired'}" style="display:flex; flex-direction:column;">
            <div class="cc-header">
                <div>
                    <div class="cc-type">${group.service_type || 'General'}</div>
                    <div class="cc-no">${group.no_kontrak}</div>
                    
                    <div class="indicator-lights">
                        <div class="status-light light-red ${red ? 'on' : ''}" title="Ada Bad Debt"></div>
                        <div class="status-light light-yellow ${showYellow ? 'on' : ''}" title="Ada Overdue"></div>
                        <div class="status-light light-green ${green && !red && !showYellow ? 'on' : ''}" title="Lancar"></div>
                    </div>
                </div>
                <div class="cc-badge ${group.is_active ? 'badge-active' : 'badge-expired'}">
                    ${group.is_active ? 'AKTIF' : 'HABIS'}
                </div>
            </div>
            
            <div class="cc-body" style="flex:1;">
                <div>
                    <span class="cc-label">Periode</span>
                    <span class="cc-val">${fmt(group.start_date)} s/d ${fmt(group.end_date)}</span>
                </div>
                
                <div class="cc-full-row" style="margin-top:10px;">
                    <span class="cc-label">Daftar Lokasi (${group.locations.length})</span>
                    <div style="max-height:60px; overflow-y:auto; background:#fafafa; border:1px solid #eee; border-radius:4px; padding:4px; margin-top:2px;">
                        ${locList}
                    </div>
                </div>

                <div class="cc-nilai-row" style="margin-top:auto; padding-top:10px; border-top:1px dashed #ddd;">
                    <span class="cc-label">Total Nilai (Akumulasi)</span>
                    <span class="cc-val" style="color:var(--accent-teal); font-size:14px;">${rp.format(group.totalValue)} /bln</span>
                </div>
            </div>

            <button class="cc-btn" onclick="openBillingDetail('${group.mainId}', '${group.service_type}', '${safeLoc}')">
                <i class="ri-file-list-3-line"></i> LIHAT SEMUA TAGIHAN
            </button>
        </div>
    `}).join('');

    container.innerHTML = html;
}

function renderDetailGroupLayout(refContract, allContracts) {
    const container = document.getElementById('app-container');
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    
    // Hitung Total Akumulasi Nilai Kontrak
    const totalNilai = allContracts.reduce((sum, c) => sum + (parseInt(c.nilai)||0), 0);
    
    // Ambil List Lokasi Unik untuk Dropdown Filter
    const uniqueLocs = [...new Set(allContracts.map(c => c.location))];
    const locOptions = uniqueLocs.map(l => `<option value="${l}">${l}</option>`).join('');

    document.body.classList.add('mode-fixed');

    container.innerHTML = `
        <div class="detail-layout-wrapper">
            <div class="detail-fixed-header">
                <div style="margin-bottom:15px;">
                    <button onclick="closeDetailAndReturn()" style="background:none; border:none; cursor:pointer; font-weight:700; color:var(--text-dark); display:flex; align-items:center; gap:5px;">
                        <i class="ri-arrow-left-line"></i> Kembali
                    </button>
                </div>
                
                <div class="dark-client-card" style="padding:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <h2 style="color:var(--accent-teal); font-weight:300; margin-bottom:5px; line-height:1;">
                                No. Kontrak: <span style="color:white; font-weight:700;">${refContract.no_kontrak}</span>
                            </h2>
                            <div style="font-size:13px; color:#b0bec5; margin-top:5px;">
                                ${formatMonthYear(refContract.start_date)} - ${formatMonthYear(refContract.end_date)}
                            </div>
                            <div style="display:flex; gap:10px; margin-top:10px;">
                                <div style="font-size:12px; color:#fff; background:#0277bd; padding:2px 8px; border-radius:4px;">
                                    ${refContract.service_type}
                                </div>
                                <div style="font-size:12px; color:#37474f; background:#cfd8dc; padding:2px 8px; border-radius:4px;">
                                    ${allContracts.length} Lokasi Gabungan
                                </div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:11px; color:#b0bec5; text-transform:uppercase;">Total Nilai (All Locations)</div>
                            <div style="font-size:20px; font-weight:700; color:var(--accent-orange);">${rp.format(totalNilai)}</div>
                        </div>
                    </div>
                </div>

                <div style="background:white; padding:10px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:10px;">
                    <i class="ri-filter-3-line" style="color:#546e7a;"></i>
                    <select id="loc-filter-select" onchange="applyDetailFilter()" style="padding:6px; border:1px solid #ccc; border-radius:4px; font-size:12px; min-width:200px;">
                        <option value="all">Semua Lokasi</option>
                        ${locOptions}
                    </select>
                    
                    <div style="margin-left:auto; font-size:12px; color:#78909c;">
                        Menampilkan: <b id="lbl-showing-count">${currentGroupBillings.length}</b> Data
                    </div>
                </div>
            </div>

            <div class="detail-scrollable-content" style="padding-top:0;">
                <div class="billing-container">
                    <table class="erp-table">
                        <thead>
                            <tr>
                                <th width="10%">Status</th>
                                <th width="12%">Periode</th>
                                <th width="20%">Lokasi</th> <th width="15%">Dokumen</th>
                                <th width="15%">Tgl (Trm/Byr)</th>
                                <th width="10%">Nilai Tagihan</th>
                                <th width="10%">Nilai Bayar</th>
                                <th width="5%">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="detail-group-body">
                            </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function applyDetailFilter() {
    const loc = document.getElementById('loc-filter-select').value;
    if(loc === 'all') {
        renderGroupBillingTable(currentGroupBillings);
    } else {
        const filtered = currentGroupBillings.filter(b => b.location === loc);
        renderGroupBillingTable(filtered);
    }
}

function renderGroupBillingTable(data) {
    const tbody = document.getElementById('detail-group-body');
    document.getElementById('lbl-showing-count').innerText = data.length;
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">Tidak ada data tagihan.</td></tr>';
        return;
    }

    const html = data.map((b, idx) => {
        // Kita gunakan fungsi createRow yang sudah ada, tapi sesuaikan parameter
        // Parameter createRow: (b, idx, isListView, cId, ...)
        // KITA HARUS MENAMBAHKAN KOLOM LOKASI SECARA MANUAL karena createRow bawaan tidak punya kolom lokasi di tengah
        
        // Agar cepat, kita buat row manual khusus untuk view ini (karena strukturnya beda dengan grid view lama)
        return createGroupRowHtml(b, idx);
    }).join('');

    tbody.innerHTML = html;
}

function createGroupRowHtml(b, idx) {
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    let statusBadge = '';
    
    if(b.status === 'Paid') statusBadge = '<span class="badge badge-green">LUNAS</span>';
    else if(b.status === 'Unpaid') statusBadge = '<span class="badge badge-yellow">UNPAID</span>';
    else if(b.status === 'Empty') statusBadge = '<span style="color:#ccc; font-weight:bold;">--</span>';
    else statusBadge = `<span class="badge badge-grey">${b.status}</span>`;

    const netVal = (b.amount || 0) - (b.pph || 0) - (b.admin || 0) + (b.overunder || 0);
    const dateRec = b.received_date ? formatDate(b.received_date) : '-';
    const datePay = b.paid_date ? formatDate(b.paid_date) : '-';

    // [PERBAIKAN LOGIKA]
    // Jangan gunakan Index (idx) karena urutan di Group View sudah di-sort/filter, 
    // sehingga tidak match dengan urutan asli 12 bulan kontrak.
    // Kita kirim NULL sebagai index, dan kirim PERIODE STRING agar openPanel mencari bulan yang tepat.
    
    const safeLoc = b.location ? b.location.replace(/'/g, "\\'") : '';
    // Parameter: (cId, idx=null, rawPeriod, service, location)
    const onClickArgs = `'${b.contract_id}', null, '${b.period}', null, '${safeLoc}'`;

    return `
        <tr>
            <td>${statusBadge}</td>
            <td style="font-weight:bold;">${b.periodDisplay || formatPeriod(b.period)}</td>
            <td style="font-size:11px; color:#455a64;">
                <i class="ri-map-pin-line"></i> ${b.location}
            </td>
            <td>
                <div class="cell-stack">
                    <span class="txt-main">${b.invoice || '-'}</span>
                    <span class="txt-sub">${b.faktur || 'No FP'}</span>
                </div>
            </td>
            <td>
                <div class="cell-stack">
                    <span class="txt-main">R: ${dateRec}</span>
                    <span class="txt-sub">P: ${datePay}</span>
                </div>
            </td>
            <td>${rp.format(b.amount || 0)}</td>
            <td style="color:${b.status === 'Paid' ? '#2e7d32' : '#546e7a'}">${rp.format(netVal)}</td>
            <td style="text-align:center;">
                <button class="btn-icon" onclick="openPanel(${onClickArgs})"><i class="ri-edit-box-line"></i></button>
            </td>
        </tr>
    `;
}

function renderContractsList(container) {
    let allBillings = [];
    const today = new Date();
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    // Reset Selection saat render ulang
    selectedBulkItems = []; 
    updateBulkButtonUI();

    let paymentDatesMap = {};

    currentClient.contracts.forEach(c => {
        c.billings.forEach((b, idx) => {
            let displayP = formatPeriod(b.period);
            let days = 0;
            const isPaidValid = (b.status === 'Paid' && b.paid_date);
            
            // [UPDATE] Tambahkan && b.status !== 'Putus' agar tidak dianggap Unpaid biasa
            const isDebt = !isPaidValid && b.status !== 'Pemutihan' && b.status !== 'Cancel' && b.status !== 'Empty' && b.status !== 'Putus';

            if (b.received_date && isDebt) {
                days = Math.ceil(Math.abs(today - new Date(b.received_date)) / 86400000);
            }

            if (isPaidValid) {
                const pDate = formatDateInput(b.paid_date);
                if (!paymentDatesMap[pDate]) paymentDatesMap[pDate] = 0;
                paymentDatesMap[pDate] += (b.amount || 0);
            }

            allBillings.push({ 
                ...b, 
                contractNo: c.no_kontrak, 
                contractId: c.id_uniq, 
                contractService: c.service_type,
                contractLocation: c.location,
                rawPeriod: b.period, 
                periodDisplay: displayP,
                ageDays: days,
                // Jika isDebt true maka 'Unpaid', jika tidak (termasuk Putus) maka pakai status aslinya
                realStatus: isDebt ? 'Unpaid' : b.status 
            });
        });
    });

    const sortedPaymentDates = Object.keys(paymentDatesMap).sort((a, b) => new Date(b) - new Date(a));

    // Filter Logic
    if (listFilterDate) {
        allBillings = allBillings.filter(b => b.status === 'Paid' && b.paid_date && formatDateInput(b.paid_date) === listFilterDate);
    } else {
        // Karena realStatus 'Putus' tidak lagi 'Unpaid', maka filter ini akan otomatis menyembunyikannya
        if (listFilterStatus === 'unpaid') allBillings = allBillings.filter(b => b.realStatus === 'Unpaid' || b.status === 'Dispute');
        else if (listFilterStatus === 'paid') allBillings = allBillings.filter(b => b.status === 'Paid');
    }

    // Sort Logic
    allBillings.sort((a, b) => {
        const dateA = new Date(a.period || a.date); 
        const dateB = new Date(b.period || b.date);
        return listSortAge === 'desc' ? dateA - dateB : dateB - dateA;
    });

    let dateOptions = `<option value="" ${listFilterDate === '' ? 'selected' : ''}>-- Semua Waktu --</option>`;
    sortedPaymentDates.forEach(dateStr => {
        const fmtDate = new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
        dateOptions += `<option value="${dateStr}" ${listFilterDate === dateStr ? 'selected' : ''}>${fmtDate} (Total: ${rp.format(paymentDatesMap[dateStr])})</option>`;
    });

    // --- HTML GENERATION ---
    container.innerHTML = `
        <div class="list-filters-bar" style="flex-wrap: wrap;">
            <div class="filter-group">
                <label>Status:</label>
                <select onchange="changeListFilter(this.value)" class="filter-select" ${listFilterDate ? 'disabled' : ''}>
                    <option value="all" ${listFilterStatus==='all'?'selected':''}>Semua</option>
                    <option value="unpaid" ${listFilterStatus==='unpaid'?'selected':''}>Hanya Unpaid</option>
                    <option value="paid" ${listFilterStatus==='paid'?'selected':''}>Hanya Lunas</option>
                </select>
            </div>

            <div class="filter-group">
                <label style="color:var(--accent-teal);"><i class="ri-secure-payment-line"></i> Tgl Bayar (Rekon):</label>
                <select onchange="changeDateFilter(this.value)" class="filter-select" style="border-color:var(--accent-teal); font-weight:bold; min-width:200px;">
                    ${dateOptions}
                </select>
                
                <button id="btnBulkPay" class="bulk-action-btn" onclick="openBulkPayModal()">
                    <i class="ri-checkbox-multiple-line"></i> Bayar Sekaligus <span id="bulkCount" class="bulk-count-badge">0</span>
                </button>
            </div>

            <div class="filter-group" style="margin-left:auto;">
                <label>Urutkan:</label>
                <select onchange="changeListSort(this.value)" class="filter-select">
                    <option value="desc" ${listSortAge==='desc'?'selected':''}>Umur (Tua > Muda)</option>
                    <option value="asc" ${listSortAge==='asc'?'selected':''}>Umur (Muda > Tua)</option>
                </select>
            </div>
        </div>

        ${listFilterDate ? `<div style="background:#e3f2fd; color:#0d47a1; padding:10px; font-size:13px; font-weight:bold; border-bottom:1px solid #bbdefb; text-align:center;">
            Menampilkan data pembayaran tanggal: ${new Date(listFilterDate).toLocaleDateString('id-ID', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}
        </div>` : ''}

        <table class="erp-table">
            <thead>
                <tr>
                    <th width="3%" style="text-align:center;"><input type="checkbox" id="chkAll" onchange="toggleSelectAll(this)"></th>
                    <th width="12%">Status</th>
                    <th width="15%">Info / Periode</th> 
                    <th width="15%">Dokumen (FP/Inv)</th>
                    <th width="15%">Tanggal (Trm/Byr)</th>
                    <th width="15%">Umur / PVSA</th>
                    <th width="12%">Nilai Tagihan</th>
                    <th width="12%">Nilai Bayar (Net)</th>
                    <th width="5%">Aksi</th>
                </tr>
            </thead>
            <tbody id="listTableBody">
                ${allBillings.length > 0 ? '' : '<tr><td colspan="9" style="text-align:center; padding:20px; color:#999;">Tidak ada data sesuai filter.</td></tr>'}
            </tbody>
        </table>
    `;

    const tbody = document.getElementById('listTableBody');
    if (allBillings.length > 0) {
        allBillings.forEach((b, idx) => {
            // IZINKAN CENTANG UNTUK PAID JUGA
            const canSelect = b.status !== 'Cancel' && b.status !== 'Pemutihan' && b.status !== 'Empty';
            
            // MASUKKAN STATUS KE VALUE CHECKBOX
            const uniqueVal = `${b.contractId}|${b.rawPeriod}|${b.amount}|${b.realStatus}`; 
            
            const checkboxHtml = canSelect 
                ? `<input type="checkbox" class="chk-row" value="${uniqueVal}" onchange="toggleSelectRow(this)">` 
                : `<i class="ri-prohibited-line" style="color:#ccc"></i>`;

            let originalRowHtml = createRow(b, null, true, b.contractId, b.rawPeriod, b.contractService, b.contractLocation);
            let contentOnly = originalRowHtml.replace('<tr>', '');
            let finalHtml = `<tr><td style="text-align:center; vertical-align:middle;">${checkboxHtml}</td>${contentOnly}`;
            
            tbody.innerHTML += finalHtml;
        });
    }
}

function changeListFilter(val) { listFilterStatus = val; renderContractsList(document.querySelector('.billing-container')); }
function changeDateFilter(val) {listFilterDate = val;renderContractsList(document.querySelector('.billing-container'));}
function changeListSort(val) { listSortAge = val; renderContractsList(document.querySelector('.billing-container')); }

function generateFullDurationBillings(contract) {
    const fullBillings = [];
    
    // Validasi Data Kontrak
    if (!contract.start_date) return contract.billings || []; 
    const duration = parseInt(contract.duration) || 12;
    const contractNilai = parseInt(contract.nilai) || 0;
    
    // Hitung Estimasi Per Bulan (DPP + PPN 11%)
    // Rumus: (Nilai Kontrak / Durasi) * 1.11
    const dppPerMonth = contractNilai / duration;
    const estimatedBill = Math.round(dppPerMonth * 1.11); 

    // Setup Tanggal Awal
    let currentDate = new Date(contract.start_date);
    // Mundurkan tanggal ke tanggal 1 agar aman dari masalah tanggal 31
    currentDate.setDate(1); 

    for (let i = 0; i < duration; i++) {
        // Ambil Bulan & Tahun Loop saat ini
        const loopMonth = currentDate.getMonth(); 
        const loopYear = currentDate.getFullYear();
        
        // Format Periode untuk Kunci Pencarian & Tampilan
        const periodKeyEN = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); 
        const periodDisplayID = currentDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }); 

        // 1. CARI DATA REAL DI DATABASE (MATCHING)
        // Kita cari apakah di array contract.billings ada data untuk bulan ini?
        const existingMatch = contract.billings.find(b => {
            if (!b.period) return false;
            
            // Cek 1: Parsing Tanggal Periode
            const d = new Date(b.period);
            if (!isNaN(d.getTime())) {
                return d.getMonth() === loopMonth && d.getFullYear() === loopYear;
            }
            
            // Cek 2: String Matching (Ex: "March 2025")
            const bStr = String(b.period).trim().toLowerCase();
            return bStr.includes(periodKeyEN.toLowerCase());
        });

        if (existingMatch) {
            // [KASUS A] DATA ADA DI DB -> Pakai Data Real
            fullBillings.push({ 
                ...existingMatch, 
                periodDisplay: periodDisplayID, 
                period: periodKeyEN, 
                isGhost: false // Ini data nyata
            });
        } else {
            // [KASUS B] DATA TIDAK ADA DI DB -> Buat Data Virtual (Ghost)
            // Ini yang membuat tampilan tetap ada 12 baris walau sheet kosong
            fullBillings.push({
                contract_id: contract.id_uniq,
                period: periodKeyEN,       // Kunci: March 2025
                periodDisplay: periodDisplayID, // Tampil: Maret 2025
                status: 'Empty',           // Status awal Empty (Abu-abu)
                amount: estimatedBill,     // Nilai otomatis terisi
                faktur: '',
                invoice: '',
                isGhost: true,             // Penanda ini data virtual
                isPPN: true                // Default PPN Yes
            });
        }
        
        // Maju 1 Bulan ke depan untuk loop berikutnya
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    return fullBillings;
}

function openBillingDetail(id, serviceType = null, location = null) {
    // 1. Cari Kontrak Utama (Target)
    let targetContract = currentClient.contracts.find(c => {
        const idMatch = c.id_uniq === id;
        const serviceMatch = serviceType ? c.service_type === serviceType : true;
        const locMatch = location ? c.location === location : true; 
        return idMatch && serviceMatch && locMatch;
    });
    
    // Fallback search
    if (!targetContract) targetContract = currentClient.contracts.find(c => c.id_uniq === id);
    if (!targetContract) return;

    // Set Global State
    selectedContract = targetContract;
    saveAppState();

    // 2. AMBIL SEMUA "SAUDARA" (Kontrak dengan No. Kontrak Sama)
    const siblings = currentClient.contracts.filter(c => c.no_kontrak === targetContract.no_kontrak);
    
    // Generate Dropdown Options untuk Filter Lokasi
    const uniqueLocs = [...new Set(siblings.map(c => c.location))];
    let locOptionsHtml = `<option value="all">-- Semua Lokasi Gabungan (${siblings.length}) --</option>`;
    
    uniqueLocs.forEach(loc => {
        const selected = (loc === targetContract.location) ? 'selected' : '';
        const shortLoc = loc.length > 60 ? loc.substring(0, 60) + '...' : loc;
        locOptionsHtml += `<option value="${loc}" ${selected}>${shortLoc}</option>`;
    });

    // 3. AGREGASI DATA BILLING (GABUNG SEMUA LOKASI)
    let combinedBillings = [];
    
    // Variabel Summary Cards
    let sumPaid = 0, sumUnpaid = 0, sumOverUnder = 0, sumAdmin = 0, sumPPh = 0;

    siblings.forEach(ctr => {
        const bills = generateFullDurationBillings(ctr);
        
        // Inject info lokasi & ID kontrak asli
        bills.forEach(b => {
            b.contractLocation = ctr.location;
            b.contractIdRaw = ctr.id_uniq;
            
            // Hitung Total untuk Summary Cards
            const isPaidValid = (b.status === 'Paid' && b.paid_date);
            const isDebt = !isPaidValid && b.status !== 'Pemutihan' && b.status !== 'Cancel' && b.status !== 'Empty' && b.status !== 'Putus';

            if(isPaidValid) sumPaid += (b.amount || 0);
            else if(isDebt) sumUnpaid += (b.amount || 0);
            
            sumOverUnder += (b.overunder || 0);
            sumAdmin += (b.admin || 0);
            sumPPh += (b.pph || 0);
        });
        combinedBillings = combinedBillings.concat(bills);
    });

    // Sort Gabungan Billing berdasarkan Tanggal
    combinedBillings.sort((a, b) => {
        const da = new Date(a.period);
        const db = new Date(b.period);
        return da - db;
    });
    
    // Simpan ke Cache Global
    generatedBillingsCache = combinedBillings; 

    // 4. GENERATE ROWS HTML (DIPERBAIKI)
    const rows = combinedBillings.map((b, i) => {
        let rowHtml = createRow(b, i, false, b.contractIdRaw, b.period, selectedContract.service_type, b.contractLocation);
        
        const safeLoc = b.contractLocation.replace(/"/g, '&quot;');
        
        // [PERBAIKAN UTAMA DI SINI]
        // Gunakan Regex /<tr/g (Global) untuk mengganti SEMUA tag <tr> 
        // Ini memastikan jika ada baris Note (baris ke-2), dia juga kena inject data-loc
        return rowHtml.replace(/<tr/g, `<tr class="billing-row-item" data-loc="${safeLoc}"`);
        
    }).join('');

    // Formatter
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    
    const currentContractIndex = currentClient.contracts.findIndex(c => c.id_uniq === selectedContract.id_uniq);
    const isFirstContract = currentContractIndex <= 0;
    const isLastContract = currentContractIndex >= currentClient.contracts.length - 1;

    const navBtnStyle = "background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:6px; width:36px; height:36px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#fff; margin-right:5px;";
    const navBtnDisabled = "opacity:0.3; cursor:default;";

    document.body.classList.add('mode-fixed');
    const container = document.getElementById('app-container');

    // 5. RENDER HTML
    container.innerHTML = `
        <div class="detail-layout-wrapper">
            <div class="detail-fixed-header">
                <div style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
                    <button onclick="closeDetailAndReturn()" style="background:none; border:none; cursor:pointer; font-weight:700; color:var(--text-dark); display:flex; align-items:center; gap:5px;">
                        <i class="ri-arrow-left-line"></i> Kembali
                    </button>
                    
                    <div style="display:flex; align-items:center; gap:8px;">
                        <label style="font-size:12px; font-weight:bold; color:#546e7a;"><i class="ri-filter-3-line"></i> Filter Lokasi:</label>
                        <select id="header-loc-filter" onchange="applyContractLocFilter(this.value)" style="padding:6px 10px; border:1px solid #cfd8dc; border-radius:6px; font-size:12px; font-weight:600; color:#37474f; max-width:250px;">
                            ${locOptionsHtml}
                        </select>
                    </div>
                </div>
                
                <div class="dark-client-card" style="padding:20px; display:block; position:relative;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div style="display:flex; gap:15px; align-items:center;">
                            <div style="display:flex;">
                                <button onclick="navContract(-1)" ${isFirstContract ? 'disabled' : ''} style="${navBtnStyle} ${isFirstContract ? navBtnDisabled : ''}">
                                    <i class="ri-arrow-left-s-line" style="font-size:20px;"></i>
                                </button>
                                <button onclick="navContract(1)" ${isLastContract ? 'disabled' : ''} style="${navBtnStyle} ${isLastContract ? navBtnDisabled : ''}">
                                    <i class="ri-arrow-right-s-line" style="font-size:20px;"></i>
                                </button>
                            </div>
                            <div>
                                <h2 style="color:var(--accent-teal); font-weight:300; margin-bottom:5px; line-height:1;">
                                    No. Kontrak: <span style="color:white; font-weight:700;">${selectedContract.no_kontrak}</span>
                                </h2>
                                <div style="font-size:13px; color:#b0bec5; margin-top:5px; display:flex; align-items:center; gap:6px;">
                                    <i class="ri-map-pin-line"></i> 
                                    <span id="header-loc-text">${selectedContract.location}</span>
                                </div>
                                <div style="font-size:12px; color:#90a4ae; margin-top:2px;">
                                    Periode: ${formatMonthYear(selectedContract.start_date)} - ${formatMonthYear(selectedContract.end_date)}
                                </div>
                                <div style="font-size:12px; color:var(--accent-orange); font-weight:bold; margin-top:8px; background:rgba(255, 167, 38, 0.1); display:inline-block; padding:2px 8px; border-radius:4px;">
                                    LAYANAN: ${selectedContract.service_type}
                                </div>
                            </div>
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:11px; color:#b0bec5; text-transform:uppercase; letter-spacing:1px;">Nilai Kontrak (Per Lokasi)</div>
                            <div style="font-size:20px; font-weight:700; color:var(--accent-orange);">${rp.format(selectedContract.nilai)}</div>
                            <div style="font-size:10px; color:#607d8b; margin-top:3px;">*Summary di bawah total gabungan</div>
                        </div>
                    </div>
                </div>

                <div class="summary-cards" style="grid-template-columns: repeat(5, 1fr);">
                    <div class="sc-item success"><span class="sc-label">Total Paid (All)</span><span class="sc-val">${rp.format(sumPaid)}</span></div>
                    <div class="sc-item danger"><span class="sc-label">Total Unpaid (All)</span><span class="sc-val">${rp.format(sumUnpaid)}</span></div>
                    <div class="sc-item warning"><span class="sc-label">Selisih (+/-)</span><span class="sc-val">${rp.format(sumOverUnder)}</span></div>
                    <div class="sc-item info"><span class="sc-label">Total Biaya Admin</span><span class="sc-val">${rp.format(sumAdmin)}</span></div>
                    <div class="sc-item" style="border-bottom: 3px solid #795548;"><span class="sc-label">Total PPh 23</span><span class="sc-val">${rp.format(sumPPh)}</span></div>
                </div>
            </div>

            <div class="detail-scrollable-content">
                <div class="billing-container">
                    <table class="erp-table">
                        <thead>
                            <tr>
                                <th width="10%">Status</th>
                                <th width="15%">Periode / Info</th>
                                <th width="15%">Dokumen (FP/Inv)</th>
                                <th width="15%">Tanggal (Trm/Byr)</th>
                                <th width="15%">Umur / PVSA</th>
                                <th width="12%">Nilai Tagihan</th>
                                <th width="12%">Nilai Bayar (Net)</th>
                                <th width="5%">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="billing-rows-body">
                            ${rows}
                        </tbody>
                    </table>
                    <div id="filter-empty-msg" style="display:none; text-align:center; padding:30px; color:#90a4ae;">
                        Tidak ada data untuk lokasi ini.
                    </div>
                </div>
            </div>
        </div>
    `;
    
    if(targetContract.location) {
        applyContractLocFilter(targetContract.location);
    }
}

function applyContractLocFilter(locVal) {
    const rows = document.querySelectorAll('.billing-row-item');
    const headerLocText = document.getElementById('header-loc-text');
    let visibleCount = 0;

    rows.forEach(row => {
        const rowLoc = row.getAttribute('data-loc');
        
        // Logika: Tampilkan jika 'all' ATAU val sama dengan lokasi baris
        if (locVal === 'all' || rowLoc === locVal) {
            row.style.display = 'table-row'; // Munculkan kembali baris (termasuk note)
            
            // Kita hitung visible count, tapi hati-hati note row tidak perlu dihitung
            // Cek apakah ini row utama (punya tombol aksi/td banyak)
            if (row.cells.length > 2) visibleCount++;
        } else {
            row.style.display = 'none'; // Sembunyikan TOTAL (Layout hilang)
        }
    });

    // Update Text Header
    if(headerLocText) {
        if(locVal === 'all') headerLocText.innerHTML = `<b>SEMUA LOKASI GABUNGAN</b>`;
        else headerLocText.innerHTML = locVal;
    }

    // Pesan Kosong
    const emptyMsg = document.getElementById('filter-empty-msg');
    if(emptyMsg) {
        emptyMsg.style.display = visibleCount === 0 ? 'block' : 'none';
    }
}

function closeDetailAndReturn() {
    selectedContract = null;
    saveAppState();
    
    // MATIKAN MODE FIXED SCROLL SAAT KEMBALI
    document.body.classList.remove('mode-fixed');
    
    renderClientProfile(currentClient);
}

// === GANTI FUNGSI createRow (VERSI CLEAN MERGED CELL) ===

// =======================================================
// UPDATE: CREATE ROW (PASS CLIENT ID)
// =======================================================

function createRow(b, idx, isListView = false, cId = null, rawPeriodString = null, cService = null, cLocation = null){
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits:0 });
    const isPPN = b.isPPN !== undefined ? b.isPPN : true; 
    const dpp = isPPN && b.amount ? Math.round(b.amount / 1.11) : (b.amount || 0);
    
    let effectiveStatus = b.status;
    if (b.status === 'Paid' && !b.paid_date) effectiveStatus = 'Unpaid';

    let statusBadge = '';
    let subStatus = '';

    if(effectiveStatus === 'Paid') statusBadge = `<span style="color:#2e7d32; font-weight:700; font-size:12px;"><span class="status-dot dot-green"></span>LUNAS</span>`;
    else if(effectiveStatus === 'Unpaid') {
        statusBadge = `<span style="color:#c62828; font-weight:700; font-size:12px;"><span class="status-dot dot-red"></span>UNPAID</span>`;
        if (b.received_date) {
            const days = Math.ceil(Math.abs(new Date() - new Date(b.received_date)) / (86400000));
            if (days > 60) subStatus = `<div style="margin-top:3px; color:#ef5350; font-size:10px; font-weight:700;">BAD DEBT (${days} Hari)</div>`;
            else if (days >= 30) subStatus = `<div style="margin-top:3px; color:#ffb74d; font-size:10px; font-weight:700;">OVERDUE (${days} Hari)</div>`;
            else subStatus = `<div style="margin-top:3px; color:#64b5f6; font-size:10px;">Within Due (${days} Hari)</div>`;
        } else { subStatus = `<div style="margin-top:3px; color:#90a4ae; font-size:10px;">Blm Terima</div>`; }
    } else if (effectiveStatus === 'Dispute') statusBadge = `<span style="color:#8e24aa; font-weight:700; font-size:12px;"><span class="status-dot" style="background:#ab47bc"></span>DISPUTE</span>`;
    else if (effectiveStatus === 'Pemutihan') statusBadge = `<span style="color:#607d8b; font-weight:700; font-size:12px; background:#eceff1; padding:2px 6px; border-radius:4px;">PEMUTIHAN</span>`;
    else if (effectiveStatus === 'Putus') statusBadge = `<span style="color:#546e7a; font-weight:700; font-size:12px;"><span class="status-dot dot-grey"></span>PUTUS</span>`;
    else if (effectiveStatus === 'Empty') {
        statusBadge = `<span style="color:#cfd8dc; font-weight:700; font-size:12px;">--</span>`;
        subStatus = `<div style="font-size:10px; color:#b0bec5">Belum Terbit</div>`;
    } else {
        statusBadge = `<span style="color:#546e7a; font-weight:700; font-size:12px;"><span class="status-dot dot-grey"></span>${effectiveStatus ? effectiveStatus.toUpperCase() : '-'}</span>`;
    }

    let umurText = '-';
    let umurSub = '';
    
    if(b.status !== 'Empty') {
        if(b.received_date) {
            if(effectiveStatus === 'Paid' && b.paid_date) {
                const diffTime = new Date(b.paid_date) - new Date(b.received_date);
                const pvsa = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                umurText = `<span style="color:#2e7d32; font-weight:700;">Selesai</span>`;
                umurSub = `<span style="color:#78909c; font-size:11px;">PVSA: ${pvsa} Hari</span>`;
            } else if(effectiveStatus === 'Unpaid' || effectiveStatus === 'Dispute') {
                const diffTime = new Date() - new Date(b.received_date);
                const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (days > 60) umurText = `<span style="color:#ef5350; font-weight:700;">BAD DEBT</span>`;
                else if (days >= 30) umurText = `<span style="color:#ffb74d; font-weight:700;">OVERDUE</span>`;
                else umurText = `<span style="color:#64b5f6; font-weight:700;">AKTIF</span>`;
                umurSub = `<span style="color:#78909c; font-size:11px;">Umur: ${days} Hari</span>`;
            } else if (effectiveStatus === 'Pemutihan') { umurText = 'Write-Off'; }
        } else { umurText = `<span style="color:#bdbdbd;">-</span>`; }
    }

    // --- FIX ARGUMEN KLIK ---
    const targetCId = isListView ? cId : selectedContract.id_uniq;
    const targetCService = isListView ? cService : selectedContract.service_type; 
    const targetCLocation = isListView ? cLocation : selectedContract.location;
    const safeLoc = targetCLocation ? targetCLocation.replace(/'/g, "\\'") : '';
    const showPeriod = b.periodDisplay || formatPeriod(b.period);
    
    const pStr = isListView ? rawPeriodString : b.period; 
    // [UPDATE] Kirim currentClient.id sebagai parameter terakhir
    const clientIdArg = currentClient ? currentClient.id : null;

    const onClickArg = isListView 
        ? `'${targetCId}', null, '${pStr}', '${targetCService}', '${safeLoc}', '${clientIdArg}'` 
        : `'${targetCId}', ${idx}, '${pStr}', null, null, '${clientIdArg}'`;

    const savedAmount = b.amount || 0;
    const savedPPh = b.pph || 0;
    const savedAdmin = b.admin || 0;
    const savedOver = b.overunder || 0;
    let netPayment = savedAmount - savedPPh - savedAdmin + savedOver;
    if (effectiveStatus === 'Pemutihan') netPayment = 0;
    const netColor = effectiveStatus === 'Paid' ? '#2e7d32' : '#546e7a';

    const hasNote = (b.note && b.note.trim() !== '');
    const mainBorderStyle = hasNote ? 'border-bottom: none;' : '';

    const mainRow = `
        <tr>
            <td style="${mainBorderStyle}">${statusBadge}${subStatus}</td>
            <td style="${mainBorderStyle}">
                ${isListView ? `<div class="txt-sub" style="font-weight:700; color:var(--accent-teal); margin-bottom:4px;">${b.contractNo} (${b.contractService})</div>` : ''}
                <div class="txt-main">${showPeriod}</div>
                <div class="txt-sub">Terbit: ${b.date?formatDate(b.date):'-'}</div>
            </td>
            <td style="${mainBorderStyle}">
                <div class="cell-stack">
                    <span class="txt-main">${b.faktur||'<span style="color:#cfd8dc">No FP</span>'}</span>
                    <span class="txt-sub" style="font-size: 14px;">${b.invoice ? ' ' + b.invoice : 'No Inv'}</span>
                </div>
            </td>
            <td style="${mainBorderStyle}">
                <div class="cell-stack">
                    <span class="txt-main">${b.received_date ? formatDate(b.received_date) : '-'}</span>
                    <span class="txt-sub">${b.paid_date ? 'Bayar: '+formatDate(b.paid_date) : 'Belum Bayar'}</span>
                </div>
            </td>
            <td style="${mainBorderStyle}"><div class="cell-stack">${umurText}${umurSub}</div></td>
            
            <td style="${mainBorderStyle}">
                <div class="cell-stack">
                    <span class="txt-money-sm">DPP: ${rp.format(dpp)}</span>
                    <span class="txt-money">Total: ${rp.format(b.amount || 0)}</span>
                </div>
            </td>
            
            <td style="${mainBorderStyle}">
                <div class="cell-stack">
                    <span class="txt-money" style="color:${netColor}">${rp.format(netPayment)}</span>
                </div>
            </td>
            
            <td style="text-align:center; ${mainBorderStyle}">
                <button class="btn-icon" onclick="openPanel(${onClickArg})"><i class="ri-edit-box-line"></i></button>
            </td>
        </tr>
    `;

    let noteRow = '';
    if (hasNote) {
        noteRow = `
            <tr>
                <td colspan="5" style="border-top:none; padding-top:0;"></td>
                <td colspan="2" style="border-top:none; padding-top:0; padding-bottom:12px;">
                    <div style="font-size: 11px; color: #90a4ae; font-style: italic; line-height: 1.2;">
                        <i class="ri-sticky-note-line" style="font-size:10px; margin-right:3px;"></i> ${b.note}
                    </div>
                </td>
                <td style="border-top:none; padding-top:0;"></td>
            </tr>
        `;
    }

    return mainRow + noteRow;
}


// =======================================================
// UPDATE: OPEN PANEL (SUPPORT GROUP CONTEXT)
// =======================================================

function openPanel(cId, idx, rawPeriodString = null, cService = null, cLocation = null, targetClientId = null) {
    let contract, bill;
    
    // 1. CONTEXT SWITCHING (LOGIKA BARU)
    // Jika targetClientId dikirim dan berbeda dengan currentClient, kita switch dulu context-nya
    // Ini penting agar saat edit di Group View, data yang terload adalah milik client yang sesuai
    if (targetClientId && currentClient && currentClient.id !== targetClientId) {
        const foundClient = clientsDB.find(c => c.id === targetClientId);
        if (foundClient) {
            console.log(`Switching context to ${foundClient.name} for editing...`);
            currentClient = foundClient; 
        }
    }

    // 2. IDENTIFIKASI KONTRAK
    let targetContract = currentClient.contracts.find(c => c.id_uniq === cId);
    
    // Fallback search
    if (!targetContract) {
         targetContract = currentClient.contracts.find(c => 
            (cService ? c.service_type === cService : true) &&
            (cLocation ? c.location === cLocation : true)
         );
    }
    
    if (!targetContract) {
        console.error("Kontrak tidak ditemukan:", cId);
        return;
    }

    selectedContract = targetContract;
    
    // Regenerate Cache Billing KHUSUS untuk kontrak ini
    generatedBillingsCache = generateFullDurationBillings(selectedContract);
    
    // 3. TENTUKAN INDEX DATA
    if (rawPeriodString && rawPeriodString !== 'null') {
        const foundIdx = generatedBillingsCache.findIndex(b => b.period === rawPeriodString);
        if (foundIdx !== -1) {
            currentBillingIndex = foundIdx;
        } else {
            // Fallback parsing date
            const targetDate = new Date(rawPeriodString);
            if (!isNaN(targetDate.getTime())) {
                currentBillingIndex = generatedBillingsCache.findIndex(b => {
                    const d = new Date(b.period);
                    return !isNaN(d.getTime()) && 
                           d.getMonth() === targetDate.getMonth() && 
                           d.getFullYear() === targetDate.getFullYear();
                });
            }
        }
    } else if (idx !== null && idx !== undefined) {
        currentBillingIndex = idx;
    }

    if (currentBillingIndex === -1 || currentBillingIndex === undefined) currentBillingIndex = 0;

    // 4. AMBIL DATA BILLING
    bill = generatedBillingsCache[currentBillingIndex];
    if (!bill) return;

    // 5. RENDER UI FORM
    const isPPN = bill.isPPN === undefined ? true : bill.isPPN; 
    let dppVal = bill.amount ? bill.amount : 0;
    if (isPPN && dppVal > 0) dppVal = Math.round(dppVal / 1.11);
    
    const titlePeriod = bill.periodDisplay || formatPeriod(bill.period);
    const fmtDPP = dppVal.toLocaleString('id-ID');
    const fmtAdmin = (bill.admin || 0).toLocaleString('id-ID');
    const fmtOver = (bill.overunder || 0).toLocaleString('id-ID');

    let isPPhChecked = false;
    if ((bill.pph || 0) > 0) isPPhChecked = true;
    else if ((bill.pph || 0) === 0 && currentClient.pph_pref === 'Yes') isPPhChecked = true;

    // Navigasi Button State
    const isFirstBill = currentBillingIndex <= 0;
    const isLastBill = currentBillingIndex >= generatedBillingsCache.length - 1;
    
    const navBtnStyle = "background:#fff; border:1px solid #cfd8dc; border-radius:50%; width:32px; height:32px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#546e7a; box-shadow:0 1px 3px rgba(0,0,0,0.1); transition:0.2s;";
    const navBtnDisabled = "background:#f5f7f8; color:#cfd8dc; border-color:#eceff1; cursor:default; box-shadow:none;";

    // HTML Content
    document.getElementById('panel-body-content').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#f5f7f8; padding:10px 15px; margin-bottom:15px; border-radius:8px; border:1px solid #eceff1;">
            <button onclick="navBilling(-1)" ${isFirstBill ? 'disabled' : ''} style="${navBtnStyle} ${isFirstBill ? navBtnDisabled : ''}">
                <i class="ri-arrow-left-s-line" style="font-size:20px;"></i>
            </button>
            <div style="text-align:center;">
                <div style="font-weight:800; color:#37474f; font-size:14px; letter-spacing:0.5px;">${selectedContract.no_kontrak}</div>
                <div style="font-size:12px; color:#78909c; margin-top:2px;">
                    ${titlePeriod} <span style="background:#e0f7fa; color:#006064; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700;">${selectedContract.service_type}</span>
                </div>
            </div>
            <button onclick="navBilling(1)" ${isLastBill ? 'disabled' : ''} style="${navBtnStyle} ${isLastBill ? navBtnDisabled : ''}">
                <i class="ri-arrow-right-s-line" style="font-size:20px;"></i>
            </button>
        </div>

        <div style="background:#fff3e0; padding:8px 12px; border:1px dashed #ffb74d; border-radius:6px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:#e65100; font-weight:bold;">
                <i class="ri-drag-move-2-line"></i> Koreksi Periode:
            </span>
            <div style="display:flex; gap:10px;">
                <button id="btn-move-prev" onclick="moveBilling('${selectedContract.id_uniq}', ${currentBillingIndex}, -1)" 
                    ${isFirstBill ? 'disabled' : ''} 
                    style="background:#fff; border:1px solid #e65100; color:#e65100; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:bold; ${isFirstBill?'opacity:0.5; cursor:not-allowed':''}" 
                    title="Geser Data ke Bulan Sebelumnya">
                    <i class="ri-arrow-left-double-line"></i> Mundur
                </button>
                <button id="btn-move-next" onclick="moveBilling('${selectedContract.id_uniq}', ${currentBillingIndex}, 1)" 
                    ${isLastBill ? 'disabled' : ''} 
                    style="background:#fff; border:1px solid #e65100; color:#e65100; border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:bold; ${isLastBill?'opacity:0.5; cursor:not-allowed':''}" 
                    title="Geser Data ke Bulan Berikutnya">
                    Maju <i class="ri-arrow-right-double-line"></i>
                </button>
            </div>
        </div>
        
        <div class="section-label">Nilai Tagihan (Revenue)</div>
        <div class="form-group">
            <label class="form-label">Nilai DPP (Dasar Pengenaan Pajak)</label>
            <input type="text" id="inp-dpp" class="form-input" value="${fmtDPP}" onkeyup="formatInputCurrency(this)" style="font-weight:bold; color:#1565c0;">
        </div>

        <div class="checkbox-group" style="justify-content:space-between;">
            <div style="display:flex; align-items:center;">
                <input type="checkbox" id="chk-ppn" ${isPPN ? 'checked' : ''} onchange="updateCalculations()">
                <label for="chk-ppn">Tambah PPN 11%</label>
            </div>
            <div id="txt-ppn-val" style="font-weight:bold; color:#546e7a;">Rp 0</div>
        </div>

        <div style="background:#fff3e0; padding:10px; border-radius:6px; border:1px solid #ffe0b2; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; font-weight:700; color:#e65100;">TOTAL TAGIHAN</span>
            <span id="txt-total-bill" style="font-size:16px; font-weight:700; color:#e65100;">Rp 0</span>
        </div>

        <div class="section-label">Potongan & Pembayaran (Net)</div>
        <div class="checkbox-group">
            <input type="checkbox" id="chk-pph" ${isPPhChecked ? 'checked' : ''} onchange="updateCalculations()">
            <label for="chk-pph">Potong PPh 23 (2% dari DPP) <span id="lbl-pph-val" style="color:#d32f2f; font-weight:bold; margin-left:5px; font-size:11px; display:none;"></span></label>
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px;">
            <div><label class="form-label">Biaya Admin</label><input type="text" id="inp-admin" class="form-input" value="${fmtAdmin}" onkeyup="formatInputCurrency(this)"></div>
            <div><label class="form-label">Kurang/Lebih Bayar</label><input type="text" id="inp-overunder" class="form-input" value="${fmtOver}" onkeyup="formatInputCurrency(this)" placeholder="-5000"></div>
        </div>

        <div class="form-group" style="background: #e8f5e9; padding: 15px; border-radius: 6px; border: 1px solid #a5d6a7;">
            <label class="form-label" style="color: #2e7d32; margin-bottom:5px;">Estimasi Total Pembayaran (Net)</label>
            <input type="text" id="inp-net-payment" class="form-input" readonly style="font-weight: 900; font-size: 20px; color: #1b5e20; background: transparent; border: none; padding: 0;">
        </div>

        <div class="section-label">Data Dokumen</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:10px;">
            <div><label class="form-label">No. Faktur</label><input type="text" id="inp-faktur" class="form-input" value="${bill.faktur||''}"></div>
            <div><label class="form-label">No. Invoice</label><input type="text" id="inp-invoice" class="form-input" value="${bill.invoice||''}"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:10px;">
            <div><label class="form-label">Tgl Terbit</label><input type="date" id="inp-date" class="form-input" value="${formatDateInput(bill.date)}"></div>
            <div><label class="form-label">Tgl Terima</label><input type="date" id="inp-rec" class="form-input" value="${formatDateInput(bill.received_date)}"></div>
        </div>
        
        <div style="background:#e3f2fd; padding:10px; border-radius:4px; border:1px solid #90caf9; margin-bottom:15px;">
             <div class="form-group" style="margin-bottom:10px;">
                <label class="form-label">Status Pembayaran</label>
                <select id="inp-status" class="form-input" style="font-weight:bold;" onchange="updateCalculations()">
                    <option value="Unpaid" ${bill.status==='Unpaid'?'selected':''}>Unpaid</option>
                    <option value="Paid" ${bill.status==='Paid'?'selected':''}>Paid (Lunas)</option>
                    <option value="Dispute" ${bill.status==='Dispute'?'selected':''}>Dispute</option>
                    <option value="Pemutihan" ${bill.status==='Pemutihan'?'selected':''}>Pemutihan (Write-Off)</option>
                    <option value="Cancel" ${bill.status==='Cancel'?'selected':''}>Cancel</option>
                    <option value="Putus" ${bill.status==='Putus'?'selected':''}>Putus</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Tgl Bayar (Wajib jika Paid)</label>
                <input type="date" id="inp-paid" class="form-input" value="${formatDateInput(bill.paid_date)}">
            </div>
        </div>
        
        <div class="form-group">
            <label class="form-label">Keterangan</label>
            <textarea id="inp-note" class="form-input" rows="3">${bill.note || ''}</textarea>
        </div>

        <button onclick="saveBillingChange()" class="btn-submit">Simpan Data</button>
    `;
    
    updateCalculations(); 
    
    document.getElementById('overlay-backdrop').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('overlay-backdrop').classList.add('show');
        document.getElementById('side-panel').classList.add('open');
    }, 10);
}

function closePanel() {
    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('overlay-backdrop').classList.remove('show');
    setTimeout(() => { document.getElementById('overlay-backdrop').classList.add('hidden'); }, 300);
}

// =======================================================
// FUNGSI UPDATE PEMBAYARAN (SIMPAN DARI MODAL)
// =======================================================
function saveBillingChange() {
    // 1. Ambil data billing yang sedang diedit dari cache
    // (currentBillingIndex diset saat tombol pensil diklik)
    const bill = generatedBillingsCache[currentBillingIndex];
    
    // 2. Ambil nilai-nilai dari Form Input di Modal
    const dpp = getRawValue('inp-dpp');
    const isPPN = document.getElementById('chk-ppn').checked;
    
    let totalAmount = dpp;
    if(isPPN) {
        totalAmount = dpp + Math.round(dpp * 0.11);
    }
    
    const isPPh = document.getElementById('chk-pph').checked;
    let pphVal = 0;
    if(isPPh) {
        pphVal = Math.round(dpp * 0.02);
    }

    const inputAdmin = getRawValue('inp-admin');
    const inputOver = getRawValue('inp-overunder');
    
    const statusVal = document.getElementById('inp-status').value;
    const paidDateVal = document.getElementById('inp-paid').value;
    
    // Normalisasi Invoice (Hapus spasi kiri/kanan)
    const newInvoiceVal = document.getElementById('inp-invoice').value.trim();

    // 3. Validasi Penting: Status Paid WAJIB ada Tanggal Bayar
    if (statusVal === 'Paid' && !paidDateVal) {
        alert("PERINGATAN: Status 'Paid' (Lunas) wajib mengisi Tanggal Bayar!");
        document.getElementById('inp-paid').focus();
        return; 
    }

    // 4. Siapkan Data yang akan dikirim ke Backend
    const payload = {
        action: 'update_billing', // Action ini yang menangani UPDATE di Backend
        
        // Kunci Pencarian Data (Agar backend tahu baris mana yang diupdate)
        contract_id: selectedContract.id_uniq,
        period: bill.period, 
        
        // Data Baru yang akan disimpan
        service_type: selectedContract.service_type, 
        location: selectedContract.location || '', 
        
        status: statusVal === 'Empty' ? 'Unpaid' : statusVal, 
        isPPN: isPPN,
        pph: pphVal,
        admin: inputAdmin,
        overunder: inputOver,
        faktur: document.getElementById('inp-faktur').value,
        invoice: newInvoiceVal,
        date: document.getElementById('inp-date').value,
        received_date: document.getElementById('inp-rec').value,
        paid_date: paidDateVal,
        note: document.getElementById('inp-note').value,
        amount: totalAmount 
    };

    // 5. Visual Feedback (Tombol Loading)
    const btn = document.querySelector('.btn-submit');
    if(btn) {
        btn.innerHTML = "<i class='ri-loader-4-line ri-spin'></i> Menyimpan...";
        btn.disabled = true;
    }

    // 6. Tutup Modal & Kirim Data
    closePanel();
    sendData(payload);
}

function saveClientInfo() {
    const newPic = document.getElementById('edit-pic').value;
    const newPhone = document.getElementById('edit-phone').value;
    const newEmail = document.getElementById('edit-email').value;
    const newNextFu = document.getElementById('edit-next-fu').value;
    const newPayment = document.getElementById('edit-payment-method').value;
    const newVA = document.getElementById('edit-va-number').value;

    // [BARU] Ambil Nilai Radio Button Preferensi PPh
    const pphPrefRadio = document.querySelector('input[name="pph_pref"]:checked');
    const newPphPref = pphPrefRadio ? pphPrefRadio.value : 'No';

    // Update object lokal (agar langsung berubah di layar tanpa reload)
    currentClient.pic = newPic;
    currentClient.phone = newPhone;
    currentClient.email = newEmail;
    currentClient.next_fu = newNextFu;
    currentClient.payment_method = newPayment;
    currentClient.va_number = newVA;
    currentClient.pph_pref = newPphPref; // Simpan lokal PPh Pref

    // Kirim ke Backend
    sendData({
        action: 'update_client',
        id: currentClient.id,
        pic: newPic,
        phone: newPhone,
        email: newEmail,
        next_fu: newNextFu,
        payment_method: newPayment,
        va_number: newVA,
        pph_pref: newPphPref // [BARU] Kirim ke Backend untuk update kolom I
    });
}

function openFollowUpModal() {
    const modal = document.getElementById('followup-modal');
    modal.classList.remove('hidden');
    renderFollowUpList();
}
function closeFollowUpModal() { document.getElementById('followup-modal').classList.add('hidden'); }
function renderFollowUpList() {
    const list = document.getElementById('followup-list');
    list.innerHTML = '';
    const sorted = [...currentClient.followUps].sort((a,b) => new Date(a.date) - new Date(b.date));
    if(sorted.length === 0) { list.innerHTML = '<div style="text-align:center; color:#999; padding:20px; font-size:12px;">Belum ada catatan follow up.</div>'; return; }
    sorted.forEach(item => {
        const div = document.createElement('div');
        div.className = 'followup-item';
        div.innerHTML = `<div class="f-meta"><span>${new Date(item.date).toLocaleString()}</span><span>User</span></div><div class="f-content">${item.text}</div>`;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}
function saveFollowUp() {
    const text = document.getElementById('new-followup-text').value;
    if(!text) return;
    const payload = { action: 'add_followup', client_id: currentClient.id, text: text };
    document.getElementById('new-followup-text').value = '';
    closeFollowUpModal();
    sendData(payload, true);
}

function openRiskModal(type) {
    const modal = document.getElementById('risk-modal');
    const container = document.getElementById('risk-list-container');
    const title = document.getElementById('risk-modal-title');
    const today = new Date();
    let filtered = [];

    // Filter Logic
    currentClient.contracts.forEach(c => {
        c.billings.forEach(b => {
            const isReallyPaid = (b.status === 'Paid' && b.paid_date);
            const status = b.status;
            let isMatch = false;

            // Filter Berdasarkan Tipe Resiko (Umur)
            if (type === 'BadDebt' || type === 'Overdue' || type === 'WithinDue') {
                const isDebt = (status !== 'Pemutihan' && status !== 'Cancel' && status !== 'Empty' && status !== 'Putus');
                if (isDebt && !isReallyPaid && b.received_date) {
                    const days = Math.ceil(Math.abs(today - new Date(b.received_date)) / 86400000);
                    if (type === 'BadDebt' && days > 60) isMatch = true;
                    if (type === 'Overdue' && days >= 30 && days <= 60) isMatch = true;
                    if (type === 'WithinDue' && days < 30) isMatch = true;
                }
            } 
            // Filter Berdasarkan Status Grid
            else if (type === 'Unpaid') {
                 if (!isReallyPaid && status !== 'Pemutihan' && status !== 'Cancel' && status !== 'Putus' && status !== 'Empty') isMatch = true;
            }
            else {
                if (status === type) isMatch = true;
            }

            if(isMatch) {
                const days = b.received_date ? Math.ceil(Math.abs(today - new Date(b.received_date)) / 86400000) : 0;
                // Pastikan 'note' diambil dari object billing (b)
                filtered.push({...b, contractNo: c.no_kontrak, days: days});
            }
        });
    });

    filtered.sort((a, b) => b.days - a.days); // Sort by days desc
    
    let displayTitle = type;
    if(type === 'Pemutihan') displayTitle = 'Write-Off (Pemutihan)';
    if(type === 'BadDebt') displayTitle = 'Bad Debt (>60 Hari)';
    if(type === 'Overdue') displayTitle = 'Overdue (30-60 Hari)';
    
    title.innerText = `Detail Tagihan: ${displayTitle}`;

    // Agar Modal Lebih Lebar untuk memuat Keterangan (Opsional, sesuaikan style CSS jika perlu)
    const modalBox = modal.querySelector('.modal-box');
    if(modalBox) modalBox.style.width = '800px'; 

    if(filtered.length === 0) container.innerHTML = `<div style="text-align:center; padding:20px; color:#999;">Tidak ada data tagihan dengan status ${displayTitle}.</div>`;
    else {
        const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
        
        container.innerHTML = `<table class="erp-table">
            <thead>
                <tr>
                    <th width="15%">No Kontrak</th>
                    <th width="15%">Invoice</th>
                    <th width="10%">Periode</th>
                    <th width="15%">Status / Umur</th>
                    <th width="15%">Nilai</th>
                    <th width="30%">Keterangan</th> </tr>
            </thead>
            <tbody>` + 
            filtered.map(x => `
                <tr>
                    <td><div style="font-weight:bold; font-size:11px;">${x.contractNo}</div></td>
                    <td>${x.invoice||'-'}</td>
                    <td>${formatPeriod(x.period)}</td>
                    <td>
                        <span style="font-weight:bold; color:#546e7a;">${x.status}</span>
                        ${x.days > 0 ? `<div style="font-size:10px; color:#90a4ae;">${x.days} Hari</div>` : ''}
                    </td>
                    <td style="font-weight:bold;">${rp.format(x.amount)}</td>
                    
                    <td>
                        <div style="font-size:11px; color:#455a64; font-style:italic; line-height:1.3;">
                            ${x.note ? x.note : '<span style="color:#cfd8dc">-</span>'}
                        </div>
                    </td>
                </tr>`).join('') + 
            `</tbody></table>`;
    }
    modal.classList.remove('hidden');
}

function closeRiskModal() { document.getElementById('risk-modal').classList.add('hidden'); }

let reminderBills = [];
function openReminderModal() {
    const modal = document.getElementById('reminder-modal');
    const list = document.getElementById('reminder-bill-list');
    const today = new Date();
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    reminderBills = [];
    currentClient.contracts.forEach(c => {
        c.billings.forEach(b => {
            const isReallyPaid = (b.status === 'Paid' && b.paid_date);
            const isDebt = (b.status !== 'Pemutihan' && b.status !== 'Cancel' && b.status !== 'Empty');
            if(isDebt && !isReallyPaid) {
                const days = b.received_date ? Math.ceil(Math.abs(today - new Date(b.received_date)) / 86400000) : 0;
                reminderBills.push({ ...b, contractNo: c.no_kontrak, days: days, selected: true }); 
            }
        });
    });
    reminderBills.sort((a, b) => b.days - a.days);
    if(reminderBills.length === 0) list.innerHTML = "<div>Tidak ada tagihan Unpaid.</div>";
    else {
        list.innerHTML = reminderBills.map((b, i) => `
            <div class="check-item"><input type="checkbox" id="rem-check-${i}" checked onchange="updateReminderText()"><div class="check-info"><strong>${b.invoice || 'No Inv'} (${rp.format(b.amount)})</strong><span style="color:#666">${formatPeriod(b.period)} - Umur ${b.days} Hari</span></div></div>`).join('');
    }
    updateReminderText();
    modal.classList.remove('hidden');
}
function updateReminderText() {
    const selected = [];
    let total = 0;
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    
    // 1. Ambil item yang dicentang
    reminderBills.forEach((b, i) => {
        const cb = document.getElementById(`rem-check-${i}`);
        if(cb && cb.checked) { selected.push(b); total += b.amount; }
    });

    // 2. Format baris tagihan
    const rows = selected.map(b => `${b.faktur||'-'} | ${b.invoice||'-'} | ${rp.format(b.amount)} | ${b.days} Hari`).join('\n');

    // === 3. LOGIKA SALAM DINAMIS (Pagi/Siang/Sore/Malam) ===
    const h = new Date().getHours(); // Ambil jam (0 - 23)
    let salam = "";

    if (h >= 0 && h < 10) {
        salam = "Selamat Pagi";
    } else if (h >= 10 && h < 14) { // Sampai jam 2 PM (14:00)
        salam = "Selamat Siang";
    } else if (h >= 14 && h < 18) { // Sampai jam 6 PM (18:00)
        salam = "Selamat Sore";
    } else {
        salam = "Selamat Malam";
    }
    // ========================================================

    // 4. Susun Pesan Akhir
    const text = `${salam}\nFriendly Reminder terkait tagihan atas nama ${currentClient.name}\n\nFaktur Pajak | Nomer Invoice | Harga | Umur :\n${rows}\n\n*Total Tagihan* = ${rp.format(total)}\n\napakah sudah diterima dan ada update untuk tanggal realisasi pembayarannya ?\n\njika sudah melakukan pembayarannya, mohon dapat di bantu dengan bukti pembayarannya untuk di update di data kami.\n\n(Pembayaran Ke Virtual Account yang tercetak di masing-masing tagihan )\n\nMengacu kebijakan management PT. ETOS INDONUSA mengenai batas pembayaran tagihan yang telah diterima pelanggan tidak lebih dari 1 Tagihan Per Lokasi Kerja, maka apabila belum ada pembayaran system ERP Kami akan mengunci otomatis layanan berikutnya dan kendala hama selama treatment dihentikan bukan menjadi tanggung jawab Kami. Selain itu system ERP juga tidak bisa menerbitkan perpanjangan kontrak.\n\nmohon responnya 🙏🙏🙏\nTerimakasih.`;
    
    document.getElementById('reminder-output').value = text;
}
function copyAndOpenWA() {
    const textarea = document.getElementById('reminder-output');
    const rawText = textarea.value;

    if (!rawText) {
        alert("Tidak ada pesan untuk disalin.");
        return;
    }

    // --- LANGKAH 1: SALIN KE CLIPBOARD ---
    textarea.select();
    textarea.setSelectionRange(0, 99999); // Support Mobile
    
    try {
        // Cara Modern & Fallback
        if (navigator.clipboard) {
            navigator.clipboard.writeText(rawText);
        } else {
            document.execCommand('copy');
        }
    } catch (err) {
        console.error('Gagal menyalin', err);
    }

    // --- LANGKAH 2: CEK DATA CLIENT ---
    // Pastikan 'currentClient' sudah terload (biasanya saat buka detail client)
    if (!currentClient) {
        alert("Data Client tidak ditemukan. Silakan refresh halaman.");
        return;
    }

    const rawPhone = currentClient.phone;

    // Jika tidak ada nomor telepon di database
    if (!rawPhone || rawPhone.trim() === '-' || rawPhone.trim() === '') {
        alert("Teks berhasil disalin! \n\nNAMUN WhatsApp tidak terbuka otomatis karena Data Nomor Telepon Client ini KOSONG di database.");
        return;
    }

    // --- LANGKAH 3: FORMAT NOMOR TELEPON ---
    // Hapus semua karakter selain angka (spasi, strip, plus, dll)
    let cleanPhone = rawPhone.toString().replace(/\D/g, '');

    // Ubah format lokal (08...) menjadi internasional (628...)
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.substring(1);
    }

    // Validasi panjang nomor (Mencegah nomor tidak valid seperti "62")
    if (cleanPhone.length < 8) {
        alert(`Teks berhasil disalin!\n\nNomor telepon tidak valid untuk WA: ${rawPhone}`);
        return;
    }

    // --- LANGKAH 4: BUKA WHATSAPP ---
    const encodedMessage = encodeURIComponent(rawText);
    const waURL = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;

    // Buka di tab baru
    window.open(waURL, '_blank');
}
function copyReminderText() {
    const txt = document.getElementById('reminder-output');
    txt.select();
    document.execCommand('copy');
}
function closeReminderModal() { document.getElementById('reminder-modal').classList.add('hidden'); }

function openSKTModal() {
    if (!currentClient) { alert("Pilih client terlebih dahulu!"); return; }
    let sktBills = [];
    let total = 0;
    currentClient.contracts.forEach(c => {
        c.billings.forEach(b => {
            const isReallyPaid = (b.status === 'Paid' && b.paid_date);
            const isDebt = (b.status !== 'Pemutihan' && b.status !== 'Cancel' && b.status !== 'Empty');
            if(isDebt && !isReallyPaid) {
                sktBills.push({ period: formatPeriod(b.period), faktur: b.faktur, invoice: b.invoice, amount: b.amount, date: b.date });
                total += (b.amount || 0);
            }
        });
    });
    sktBills.sort((a,b) => new Date(a.date) - new Date(b.date));
    const payload = { client: { name: currentClient.name, address: currentClient.address }, bills: sktBills, total: total };
    localStorage.setItem('skt_print_data', JSON.stringify(payload));
    window.open('print_skt.html', '_blank');
}

function navBilling(step) {
    const newIndex = currentBillingIndex + step;
    if (newIndex < 0 || newIndex >= generatedBillingsCache.length) return;
    currentBillingIndex = newIndex;
    openPanel(selectedContract.id_uniq, currentBillingIndex, null, null);
}

function navContract(step) {
    const currentIndex = currentClient.contracts.findIndex(c => 
        c.id_uniq === selectedContract.id_uniq && 
        c.service_type === selectedContract.service_type &&
        c.location === selectedContract.location // [BARU] Cek Lokasi
    );
    const newIndex = currentIndex + step;
    if (newIndex < 0 || newIndex >= currentClient.contracts.length) return;
    const targetContract = currentClient.contracts[newIndex];
    // [UPDATE] Panggil dengan lokasi
    openBillingDetail(targetContract.id_uniq, targetContract.service_type, targetContract.location);
}

// EVENT LISTENER TOMBOL BACK/FORWARD (MOUSE & BROWSER)
window.addEventListener('popstate', function(event) {
    if (event.state) {
        const p = event.state.page;
        if (p === 'ar_monitor') {
            navigate('ar_monitor', false);
            const lastAge = localStorage.getItem('etos_last_age_search');
            if (lastAge) {
                setTimeout(() => {
                    const dd = document.getElementById('globalAgeInput');
                    if(dd) { dd.value = lastAge; runGlobalAgeSearch(); }
                }, 50);
            }
        } else if (p === 'client_detail') {
            const cId = event.state.clientId;
            if (cId) {
                selectClient(cId, false);
            }
        }
    } else {
        navigate('ar_monitor', false);
    }
});


// === FUNGSI GESER PERIODE (MOVE/SWAP) ===

function moveBilling(contractId, currentIndex, direction) {
    // 1. Ambil Data
    const targetContract = currentClient.contracts.find(c => c.id_uniq === contractId);
    if (!targetContract) return;

    // GeneratedBillingsCache berisi data urut bulan (Jan - Des)
    const bills = generatedBillingsCache; 
    const targetIndex = currentIndex + direction;

    // 2. Validasi Batas (Tidak bisa geser ke tahun lalu/depan di luar kontrak)
    if (targetIndex < 0 || targetIndex >= bills.length) {
        alert("Tidak bisa menggeser ke luar rentang periode kontrak (12 Bulan)!");
        return;
    }

    const currentBill = bills[currentIndex];
    const targetBill = bills[targetIndex]; // Bulan tujuan (misal November)

    // 3. Konfirmasi User
    const actionName = direction > 0 ? "MAJU (Bulan Depan)" : "MUNDUR (Bulan Lalu)";
    let confirmMsg = `Konfirmasi Geser Periode ${actionName}:\n\n`;
    confirmMsg += `Dari: ${currentBill.periodDisplay}\nKe:   ${targetBill.periodDisplay}\n\n`;

    // Cek apakah bulan tujuan sudah ada isinya?
    const isTargetFilled = targetBill.status !== 'Empty' && !targetBill.isGhost;
    if (isTargetFilled) {
        confirmMsg += `PERINGATAN: Bulan tujuan (${targetBill.periodDisplay}) SUDAH TERISI data.\nData akan saling BERTUKAR tempat (Swap).\n\nLanjutkan?`;
    } else {
        confirmMsg += `Data akan dipindahkan ke bulan ${targetBill.periodDisplay}. Lanjutkan?`;
    }

    if (!confirm(confirmMsg)) return;

    // 4. Kirim ke Backend
    const payload = {
        action: 'swap_billing_period',
        contract_id: contractId,
        period_a: currentBill.period, // String "October 2025"
        period_b: targetBill.period,  // String "November 2025"
        service_type: targetContract.service_type
    };

    // UI Feedback
    const btnId = direction > 0 ? 'btn-move-next' : 'btn-move-prev';
    const btn = document.getElementById(btnId);
    if(btn) { btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>'; btn.disabled = true; }

    sendData(payload);
}

// === LOGIKA BULK SELECTION ===

function toggleSelectRow(checkbox) {
    const val = checkbox.value; // format: contractId|period|amount
    if (checkbox.checked) {
        selectedBulkItems.push(val);
    } else {
        selectedBulkItems = selectedBulkItems.filter(item => item !== val);
    }
    updateBulkButtonUI();
}

function toggleSelectAll(masterChk) {
    const checkboxes = document.querySelectorAll('.chk-row');
    selectedBulkItems = [];
    
    checkboxes.forEach(chk => {
        chk.checked = masterChk.checked;
        if (masterChk.checked) {
            selectedBulkItems.push(chk.value);
        }
    });
    updateBulkButtonUI();
}


// =======================================================
// 1. UPDATE: LOGIKA TOMBOL BULK (SUPPORT UPDATE LUNAS)
// =======================================================
function updateBulkButtonUI() {
    const btnMain = document.getElementById('btnBulkPay');
    const badgeMain = document.getElementById('bulkCount');
    const btnGroup = document.getElementById('btnGroupBulkPay');
    
    // 1. Cek Status Item yang Dipilih
    let hasPaid = false;
    let hasUnpaid = false;

    selectedBulkItems.forEach(val => {
        const parts = val.split('|');
        // Index 3 adalah status real (Paid/Unpaid)
        const status = parts[3]; 
        
        if (status === 'Paid') hasPaid = true;
        else hasUnpaid = true;
    });

    // 2. Tentukan Mode Tombol
    let btnText = '<i class="ri-checkbox-multiple-line"></i> Bayar Sekaligus';
    let btnColor = 'var(--accent-green)'; // Hijau (Default)
    let actionFunc = openBulkPayModal; // Default Action
    let isDisabled = false;

    if (hasPaid && hasUnpaid) {
        // KASUS A: Campur (Ada Paid & Unpaid) -> Dilarang
        btnText = '<i class="ri-error-warning-line"></i> Status Campuran';
        btnColor = '#90a4ae'; // Abu-abu
        isDisabled = true;
    } else if (hasPaid) {
        // [UPDATE LOGIKA] KASUS B: Hanya Paid (Lunas) -> MODE UPDATE
        // Dulu: Mode Undo (Batal). Sekarang: Mode Update Data.
        btnText = '<i class="ri-edit-circle-line"></i> Update Data Bayar';
        btnColor = '#f57c00'; // Oranye
        actionFunc = openBulkPayModal; // Tetap buka modal form
    }
    // KASUS C: Hanya Unpaid -> Tetap "Bayar Sekaligus" (Hijau)

    // 3. Update Tampilan Tombol
    const updateBtn = (btn, badge) => {
        if (!btn) return;
        
        if (badge) badge.innerText = selectedBulkItems.length;
        const badgeInner = btn.querySelector('.bulk-count-badge');
        if (badgeInner) badgeInner.innerText = selectedBulkItems.length;

        if (selectedBulkItems.length > 0) {
            // Jika ada item terpilih
            btn.innerHTML = `${btnText} <span class="bulk-count-badge" style="background:white; color:${btnColor}; padding:2px 6px; border-radius:4px; margin-left:5px;">${selectedBulkItems.length}</span>`;
            btn.style.background = btnColor;
            btn.classList.add('active');
            btn.disabled = isDisabled;
            
            // Pasang fungsi klik yang sesuai
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.onclick = actionFunc; 
            
        } else {
            // Jika tidak ada item terpilih (Reset)
            btn.innerHTML = `<i class="ri-checkbox-multiple-line"></i> Bayar Sekaligus <span class="bulk-count-badge" id="bulkCount">0</span>`;
            btn.style.background = 'var(--accent-green)';
            btn.classList.remove('active');
            btn.disabled = true;
        }
    };

    updateBtn(btnMain, badgeMain);
    updateBtn(btnGroup, null);
}

// =======================================================
// 2. UPDATE: MODAL BULK (DUAL MODE: BAYAR & UPDATE)
// =======================================================
function openBulkPayModal() {
    if (selectedBulkItems.length === 0) return;

    // Cek apakah ini mode Update (Barang sudah lunas)
    const isUpdateMode = selectedBulkItems.some(item => item.split('|')[3] === 'Paid');

    // 1. Hitung Total Tagihan Kotor
    bulkTotalAmountCache = 0;
    selectedBulkItems.forEach(item => {
        const parts = item.split('|');
        bulkTotalAmountCache += parseFloat(parts[2] || 0); 
    });
    
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    const modal = document.getElementById('risk-modal'); 
    const container = document.getElementById('risk-list-container');
    const title = document.getElementById('risk-modal-title');
    
    // Judul Dinamis
    const titleText = isUpdateMode ? "Update Pembayaran Massal" : "Bayar Sekaligus";
    const btnLabel = isUpdateMode ? "UPDATE DATA" : "PROSES PEMBAYARAN";
    const bgHeader = isUpdateMode ? "#fff3e0" : "#e3f2fd"; // Oranye vs Biru
    const borderHeader = isUpdateMode ? "#ffe0b2" : "#90caf9";
    const textHeader = isUpdateMode ? "#e65100" : "#0d47a1";

    title.innerHTML = `<i class="ri-checkbox-multiple-line"></i> ${titleText} (${selectedBulkItems.length} Item)`;
    
    // Tombol Batal Bayar (Undo) hanya muncul jika mode Update
    const undoButtonHtml = isUpdateMode 
        ? `<button onclick="triggerBulkUndo()" style="background:white; border:1px solid #ef5350; color:#ef5350; padding:10px 15px; border-radius:4px; font-weight:bold; cursor:pointer; margin-right:auto;">
             <i class="ri-arrow-go-back-line"></i> Batalkan Lunas
           </button>` 
        : ``;

    container.innerHTML = `
        <div style="background:${bgHeader}; padding:15px; border-radius:8px; border:1px solid ${borderHeader}; margin-bottom:15px; text-align:center;">
            <div style="font-size:11px; color:${textHeader}; font-weight:bold; text-transform:uppercase;">Total Nilai Terpilih</div>
            <div style="font-size:20px; font-weight:900; color:${textHeader};">${rp.format(bulkTotalAmountCache)}</div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Tanggal Bayar Baru</label>
                <input type="date" id="bulk-pay-date" class="form-input" style="font-weight:bold;">
            </div>
            
            <div style="display:flex; align-items:flex-end; padding-bottom:10px;">
                 <div class="checkbox-group" style="width:100%; margin-bottom:0; justify-content:center;">
                    <input type="checkbox" id="chk-bulk-pph" onchange="recalcBulk()">
                    <label for="chk-bulk-pph">Potong PPh 23 (2%)</label>
                </div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
            <div>
                <label class="form-label">Biaya Admin</label>
                <input type="text" id="inp-bulk-admin" class="form-input" placeholder="0" onkeyup="formatInputCurrency(this); recalcBulk()">
            </div>
            <div>
                <label class="form-label">Kurang/Lebih Bayar</label>
                <input type="text" id="inp-bulk-over" class="form-input" placeholder="-5000" onkeyup="formatInputCurrency(this); recalcBulk()">
            </div>
        </div>

        <div class="form-group">
            <label class="form-label">Keterangan / Catatan</label>
            <textarea id="inp-bulk-note" class="form-input" rows="2" placeholder="Contoh: Koreksi tanggal bayar..."></textarea>
        </div>

        <div style="background:#e8f5e9; padding:15px; border-radius:6px; border:1px solid #a5d6a7; margin-bottom:20px;">
            <div style="font-size:11px; color:#2e7d32; font-weight:bold; text-transform:uppercase; margin-bottom:5px;">Estimasi Total Masuk (Net)</div>
            <div id="txt-bulk-net" style="font-size:24px; font-weight:900; color:#1b5e20;">${rp.format(bulkTotalAmountCache)}</div>
            <div id="txt-bulk-pph-info" style="font-size:10px; color:#388e3c; margin-top:5px; font-style:italic; display:none;">Termasuk potongan PPh</div>
        </div>

        <div style="display:flex; justify-content:end; gap:10px; align-items:center;">
            ${undoButtonHtml} 
            
            <button onclick="closeRiskModal()" style="background:#cfd8dc; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer; color:#546e7a;">Tutup</button>
            <button onclick="submitBulkPay()" style="background:var(--accent-green); color:white; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
                <i class="ri-save-3-line"></i> ${btnLabel}
            </button>
        </div>
    `;
    
    modal.classList.remove('hidden');
    document.getElementById('bulk-pay-date').valueAsDate = new Date();
    
    recalcBulk();
}

// =======================================================
// 3. UPDATE: SUBMIT BULK (SUPPORT UPDATE DATA)
// =======================================================
function submitBulkPay() {
    const dateVal = document.getElementById('bulk-pay-date').value;
    if (!dateVal) { alert("Harap isi Tanggal Pembayaran!"); return; }

    const count = selectedBulkItems.length;
    // Cek mode update atau bayar baru untuk pesan konfirmasi
    const isUpdate = document.getElementById('risk-modal-title').innerText.includes("Update");
    const msg = isUpdate 
        ? `Yakin ingin MENGUPDATE data pembayaran untuk ${count} tagihan?\nTanggal bayar akan diubah menjadi: ${dateVal}`
        : `Yakin ingin memproses pembayaran untuk ${count} tagihan?`;

    if(!confirm(msg)) return;

    // Ambil Data Tambahan
    const isPPh = document.getElementById('chk-bulk-pph').checked;
    const adminVal = getRawValue('inp-bulk-admin');
    const overVal = getRawValue('inp-bulk-over') || getRawValue('inp-overunder');
    const noteVal = document.getElementById('inp-bulk-note').value;

    const items = selectedBulkItems.map(raw => {
        const parts = raw.split('|');
        return { contract_id: parts[0], period: parts[1] };
    });

    const payload = {
        action: 'bulk_update_payment', // Backend sudah support update (overwrite)
        items: items,
        paid_date: dateVal,
        is_pph: isPPh,        
        admin_fee: adminVal,  
        overunder_val: overVal,
        note: noteVal 
    };

    const btn = document.querySelector('#risk-list-container button:last-child');
    if(btn) { btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Memproses...'; btn.disabled = true; }

    sendData(payload); 
    closeRiskModal();
}

// === LOGIKA MODAL BULK PAY ===

function openBulkPayModal() {
    if (selectedBulkItems.length === 0) return;

    // 1. Hitung Total Tagihan Kotor
    bulkTotalAmountCache = 0;
    selectedBulkItems.forEach(item => {
        const parts = item.split('|');
        bulkTotalAmountCache += parseFloat(parts[2] || 0); 
    });
    
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    const modal = document.getElementById('risk-modal'); 
    const container = document.getElementById('risk-list-container');
    const title = document.getElementById('risk-modal-title');
    
    title.innerHTML = `<i class="ri-checkbox-multiple-line"></i> Bayar Sekaligus (${selectedBulkItems.length} Item)`;
    
    container.innerHTML = `
        <div style="background:#e3f2fd; padding:15px; border-radius:8px; border:1px solid #90caf9; margin-bottom:15px; text-align:center;">
            <div style="font-size:11px; color:#1565c0; font-weight:bold; text-transform:uppercase;">Total Tagihan Terpilih</div>
            <div style="font-size:20px; font-weight:900; color:#0d47a1;">${rp.format(bulkTotalAmountCache)}</div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Tanggal Bayar</label>
                <input type="date" id="bulk-pay-date" class="form-input" style="font-weight:bold;">
            </div>
            
            <div style="display:flex; align-items:flex-end; padding-bottom:10px;">
                 <div class="checkbox-group" style="width:100%; margin-bottom:0; justify-content:center;">
                    <input type="checkbox" id="chk-bulk-pph" onchange="recalcBulk()">
                    <label for="chk-bulk-pph">Potong PPh 23 (2%)</label>
                </div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
            <div>
                <label class="form-label">Biaya Admin</label>
                <input type="text" id="inp-bulk-admin" class="form-input" placeholder="0" onkeyup="formatInputCurrency(this); recalcBulk()">
            </div>
            <div>
                <label class="form-label">Kurang/Lebih Bayar</label>
                <input type="text" id="inp-bulk-over" class="form-input" placeholder="-5000" onkeyup="formatInputCurrency(this); recalcBulk()">
            </div>
        </div>

        <div class="form-group">
            <label class="form-label">Keterangan / Catatan</label>
            <textarea id="inp-bulk-note" class="form-input" rows="2" placeholder="Contoh: Pembayaran Bulk Transfer via BCA..."></textarea>
        </div>

        <div style="background:#e8f5e9; padding:15px; border-radius:6px; border:1px solid #a5d6a7; margin-bottom:20px;">
            <div style="font-size:11px; color:#2e7d32; font-weight:bold; text-transform:uppercase; margin-bottom:5px;">Estimasi Total Masuk (Net)</div>
            <div id="txt-bulk-net" style="font-size:24px; font-weight:900; color:#1b5e20;">${rp.format(bulkTotalAmountCache)}</div>
            <div id="txt-bulk-pph-info" style="font-size:10px; color:#388e3c; margin-top:5px; font-style:italic; display:none;">Termasuk potongan PPh</div>
        </div>

        <div style="display:flex; justify-content:end; gap:10px;">
            <button onclick="closeRiskModal()" style="background:#cfd8dc; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">Batal</button>
            <button onclick="submitBulkPay()" style="background:var(--accent-green); color:white; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">
                <i class="ri-check-double-line"></i> PROSES PEMBAYARAN
            </button>
        </div>
    `;
    
    modal.classList.remove('hidden');
    document.getElementById('bulk-pay-date').valueAsDate = new Date();
    
    recalcBulk();
}

// FUNGSI HITUNG REAL-TIME (ESTIMASI)
function recalcBulk() {
    const isPPh = document.getElementById('chk-bulk-pph').checked;
    const admin = getRawValue('inp-bulk-admin') || 0;
    const overunder = getRawValue('inp-overunder') || getRawValue('inp-bulk-over') || 0; // Handle beda ID input

    let totalPPh = 0;

    // Hitung Estimasi PPh
    if (isPPh) {
        // Asumsi: Kita hitung PPh dari Total Kotor secara kasar (atau loop item jika mau presisi)
        // Agar presisi sama dengan backend, kita loop item
        selectedBulkItems.forEach(item => {
            const parts = item.split('|');
            const amt = parseFloat(parts[2] || 0);
            // Asumsi default PPN 11% (amount / 1.11 * 0.02)
            // Ini estimasi, di backend akan dicek per baris isPPN true/false nya
            const dppEst = Math.round(amt / 1.11); 
            totalPPh += Math.round(dppEst * 0.02);
        });
    }

    const netTotal = bulkTotalAmountCache - totalPPh - admin + overunder;

    // Update UI
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    document.getElementById('txt-bulk-net').innerText = rp.format(netTotal);
    
    const infoPPh = document.getElementById('txt-bulk-pph-info');
    if(isPPh) {
        infoPPh.style.display = 'block';
        infoPPh.innerText = `(Potongan PPh: ${rp.format(totalPPh)})`;
    } else {
        infoPPh.style.display = 'none';
    }
}

function submitBulkPay() {
    const dateVal = document.getElementById('bulk-pay-date').value;
    if (!dateVal) { alert("Harap isi Tanggal Pembayaran!"); return; }

    if(!confirm(`Yakin ingin memproses pembayaran untuk ${selectedBulkItems.length} tagihan?`)) return;

    // Ambil Data Tambahan
    const isPPh = document.getElementById('chk-bulk-pph').checked;
    const adminVal = getRawValue('inp-bulk-admin');
    const overVal = getRawValue('inp-bulk-over'); // Pastikan ID ini sama dengan HTML di atas

    const items = selectedBulkItems.map(raw => {
        const parts = raw.split('|');
        return { contract_id: parts[0], period: parts[1] };
    });

    const payload = {
        action: 'bulk_update_payment',
        items: items,
        paid_date: dateVal,
        is_pph: isPPh,        // Kirim status checkbox
        admin_fee: adminVal,  // Kirim nilai admin
        overunder_val: overVal // Kirim nilai overunder
    };

    const btn = document.querySelector('#risk-list-container button:last-child');
    if(btn) { btn.innerHTML = 'Memproses...'; btn.disabled = true; }

    sendData(payload); 
    closeRiskModal();
}
// ==========================================
// FITUR INPUT KONTRAK BARU (NEW CONTRACT UI)
// ==========================================

let isNewClientMode = true; 

// ==========================================
// 1. LOGIKA INPUT KONTRAK (MULTI LOKASI)
// ==========================================

function openNewContractModal() {
    const modal = document.getElementById('new-contract-modal');
    modal.classList.remove('hidden');
    
    // Reset Form Utama
    document.getElementById('nc-contract-no').value = '';
    document.getElementById('nc-uniq-id').value = '';
    document.getElementById('nc-start-date').value = '';
    document.getElementById('nc-end-date').value = '';
    document.getElementById('nc-amount').value = '';
    document.getElementById('nc-location').value = '';
    document.getElementById('nc-client-name').value = ''; // Kosongkan nama
    
    // Reset Mode ke Single (Default)
    const radioSingle = document.querySelector('input[name="contractMode"][value="single"]');
    if(radioSingle) radioSingle.checked = true;
    toggleContractMode();

    // Reset Multi Container
    const multiContainer = document.getElementById('multi-loc-container');
    if(multiContainer) {
        multiContainer.innerHTML = '';
        addLocationRow(); 
        updateMultiTotal();
    }

    // LOGIKA GEMBOK & STATUS
    if (currentClient) {
        // Jika buka dari dashboard (sudah ada client)
        document.getElementById('nc-client-name').value = currentClient.name;
        document.getElementById('nc-client-id').value = currentClient.id;
        
        // Render status "TERDAFTAR" (Hapus Unidentified)
        renderSmartContractListInHeader(currentClient); 
        
        toggleContractDetail(true); // BUKA GEMBOK
    } else {
        // Jika buka dari tombol hijau (Input Baru)
        document.getElementById('nc-client-id').value = '';
        
        // Tampilkan status "Menunggu Input"
        const statusDiv = document.getElementById('nc-client-status');
        statusDiv.innerHTML = `<span style="color:#94a3b8; font-style:italic; font-size:12px;">Silakan cari atau ketik nama pelanggan...</span>`;
        
        toggleContractDetail(false); // KUNCI GEMBOK (POIN 1)
    }
}

function toggleContractMode() {
    const mode = document.querySelector('input[name="contractMode"]:checked').value;
    const singleDiv = document.getElementById('single-mode-inputs');
    const multiDiv = document.getElementById('multi-mode-inputs');

    if (mode === 'multi') {
        singleDiv.style.display = 'none';
        multiDiv.style.display = 'block';
    } else {
        singleDiv.style.display = 'block';
        multiDiv.style.display = 'none';
    }
}

// Fungsi Tambah Baris Lokasi (Support Pre-fill)
// Update fungsi ini agar bisa menyimpan ID (jika ada)
// Fungsi Tambah Baris Lokasi (Updated: Support ID Uniq agar tidak duplikat)
function addLocationRow(preLocation = '', preValue = '', currentId = '') {
    const container = document.getElementById('multi-loc-container');
    if(!container) return;

    // ID unik untuk DOM element (bukan ID database)
    const domId = Date.now() + Math.floor(Math.random()*1000); 
    
    // Format nilai uang jika ada isinya
    let formattedVal = preValue;
    if(preValue && preValue !== '') {
        // Pastikan format string angka yang benar
        formattedVal = parseInt(String(preValue).replace(/[^0-9]/g, '')) || 0;
        formattedVal = formattedVal.toLocaleString('id-ID');
    }

    const rowHtml = `
        <div class="multi-row" id="row-${domId}" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
            <input type="hidden" class="multi-loc-id" value="${currentId}">
            
            <div style="flex: 2;">
                <input type="text" class="form-input multi-loc-name" placeholder="Nama Lokasi / Cabang" value="${preLocation}" style="font-size: 11px; font-weight:600; color:#334155;">
            </div>
            <div style="flex: 1;">
                <input type="text" class="form-input currency-input multi-loc-val" placeholder="Rp Nilai" value="${formattedVal}" onkeyup="formatInputCurrency(this); updateMultiTotal()" style="font-size: 11px; text-align:right;">
            </div>
            <button onclick="removeLocationRow('${domId}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 4px; cursor: pointer; padding: 4px 8px; height: 32px; display:flex; align-items:center;" title="Hapus Baris">
                <i class="ri-delete-bin-line"></i>
            </button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHtml);
    
    // Update total setelah render
    updateMultiTotal(); 
}

// Fungsi Hapus Baris Lokasi (- Button)
function addLocationRow() {
    const container = document.getElementById('multi-loc-container');
    const id = Date.now() + Math.floor(Math.random()*1000); 
    const rowHtml = `
        <div class="multi-row" id="row-${id}" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start; padding-bottom: 8px; border-bottom: 1px dashed #eee;">
            <div style="flex: 2;">
                <input type="text" class="form-input multi-loc-name" placeholder="Nama Lokasi / Cabang..." style="font-size: 11px;">
            </div>
            <div style="flex: 1;">
                <input type="text" class="form-input currency-input multi-loc-val" placeholder="Rp Nilai" onkeyup="formatInputCurrency(this); updateMultiTotal()" style="font-size: 11px;">
            </div>
            <button onclick="removeLocationRow('${id}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 4px; cursor: pointer; padding: 4px 8px; height: 32px;">
                <i class="ri-delete-bin-line"></i>
            </button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHtml);
}

function removeLocationRow(id) {
    const row = document.getElementById(`row-${id}`);
    if(row) row.remove();
    updateMultiTotal();
}

function updateMultiTotal() {
    const inputs = document.querySelectorAll('.multi-loc-val');
    let total = 0;
    
    inputs.forEach(inp => {
        // Hapus karakter non-digit (Rp, titik, dll)
        let valStr = inp.value.replace(/[^0-9]/g, ''); 
        total += valStr ? parseInt(valStr) : 0;
    });

    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    
    const lblTotal = document.getElementById('lbl-total-multi');
    if(lblTotal) {
        lblTotal.innerText = rp.format(total);
        // Ubah warna jika total > 0
        lblTotal.style.color = total > 0 ? '#16a34a' : '#64748b';
    }
}

// UPDATE: SAVE NEW CONTRACT (Support Single & Multi)
// === UPDATE: SAVE CONTRACT (SUPPORT MULTI) ===
function saveNewContract() {
    // Gunakan selector yang spesifik
    const btn = document.querySelector('#new-contract-modal button[onclick="saveNewContract()"]') || document.querySelector('button[onclick="saveNewContract()"]');
    const originalText = btn ? btn.innerHTML : 'Simpan';
    
    if(btn) {
        btn.innerHTML = "<i class='ri-loader-4-line ri-spin'></i> Menyimpan...";
        btn.disabled = true;
    }

    // 1. Ambil Data Header
    const clientId = document.getElementById('nc-client-id').value;
    const noKontrak = document.getElementById('nc-contract-no').value;
    const serviceType = document.getElementById('nc-service-type').value;
    const startDate = document.getElementById('nc-start-date').value;
    const endDate = document.getElementById('nc-end-date').value;
    const pphPref = document.getElementById('nc-pph-pref').value;

    // Validasi Header
    if (!clientId) { 
        alert("Pilih client terlebih dahulu!"); 
        if(btn) { btn.innerHTML = originalText; btn.disabled = false; }
        return; 
    }
    if (!noKontrak) { 
        alert("Nomor kontrak wajib diisi!"); 
        if(btn) { btn.innerHTML = originalText; btn.disabled = false; }
        return; 
    }

    // 2. Cek Mode Input (Single / Multi)
    const mode = document.querySelector('input[name="contractMode"]:checked').value;
    let itemsPayload = [];

    if (mode === 'single') {
        // Mode Single
        const val = document.getElementById('nc-amount').value;
        const loc = document.getElementById('nc-location').value;
        // Ambil ID Unik header jika ada (untuk update data single)
        const headId = document.getElementById('nc-uniq-id').value;

        if(!val || !loc) { 
            alert("Nilai dan Lokasi wajib diisi!"); 
            if(btn) { btn.innerHTML = originalText; btn.disabled = false; }
            return; 
        }
        itemsPayload.push({ location: loc, nilai: val, id_uniq: headId });

    } else {
        // Mode Multi: Loop semua baris input dinamis
        const rows = document.querySelectorAll('.multi-row');
        rows.forEach(row => {
            const locName = row.querySelector('.multi-loc-name').value;
            const locVal = row.querySelector('.multi-loc-val').value;
            // [FIX] Ambil ID dari hidden input (ini yang memperbaiki duplikasi)
            const locId = row.querySelector('.multi-loc-id') ? row.querySelector('.multi-loc-id').value : ''; 

            // Hanya ambil baris yang terisi nama & nilai
            if(locName && locVal) {
                itemsPayload.push({ 
                    location: locName, 
                    nilai: locVal,
                    // Jika locId ada (misal 00347.KP), backend akan UPDATE. 
                    // Jika locId kosong, backend akan INSERT BARU.
                    id_uniq: locId 
                });
            }
        });

        if(itemsPayload.length === 0) { 
            alert("Isi minimal satu lokasi!"); 
            if(btn) { btn.innerHTML = originalText; btn.disabled = false; }
            return; 
        }
    }

    // 3. Siapkan Payload
    const payload = {
        action: 'save_new_contract_multi', 
        client_id: clientId,
        no_kontrak: noKontrak,
        service_type: serviceType,
        start_date: startDate,
        end_date: endDate,
        pph_pref: pphPref,
        items: itemsPayload 
    };

    // 4. Kirim Data
    fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(res => {
        if(res.status === 'success') {
            alert("Kontrak Berhasil Disimpan & Diupdate!");
            closeNewContractModal();
            loadData(true); // Refresh data tanpa reload page
        } else {
            alert("Gagal: " + res.message);
        }
    })
    .catch(err => alert("Error Koneksi: " + err))
    .finally(() => {
        if(btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });
}

// ==========================================
// 2. RENDER CARD KONTRAK (GROUPING LOGIC)
// ==========================================

function renderClientDetails(client) {
    currentClient = client;
    
    // Sembunyikan Dashboard, Tampilkan Detail View (Sesuaikan ID view Anda)
    // Contoh:
    document.getElementById('dashboard-view').classList.add('hidden'); 
    document.getElementById('client-detail-view').classList.remove('hidden');

    // ... Code set nama client dll ...

    // Filter Kontrak Client Ini
    const clientContracts = contractsDB.filter(c => c.client_id === client.id && c.is_active === true);
    
    // GROUPING LOGIC
    const groupedContracts = {};
    clientContracts.forEach(c => {
        const key = c.no_kontrak ? c.no_kontrak.trim() : ('UNKNOWN_' + c.id_uniq);
        
        if (!groupedContracts[key]) {
            groupedContracts[key] = {
                no_kontrak: c.no_kontrak,
                service_type: c.service_type,
                start_date: c.start_date,
                end_date: c.end_date,
                locations: [],
                totalValue: 0,
                allIds: [] // Menyimpan semua ID_UNIQ untuk referensi billing
            };
        }
        // Tambah data ke group
        groupedContracts[key].locations.push(c.location);
        // Clean nilai sebelum parse
        let cleanVal = String(c.nilai).replace(/[^0-9]/g, '');
        groupedContracts[key].totalValue += parseInt(cleanVal || 0);
        groupedContracts[key].allIds.push(c.id_uniq);
    });

    // Render Cards
    const container = document.getElementById('contract-cards-container');
    container.innerHTML = '';
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    Object.values(groupedContracts).forEach(group => {
        // Buat List Lokasi Scrollable di Kartu
        const locListHTML = group.locations.map(l => 
            `<div style="font-size:11px; color:#64748b; padding-bottom:2px; border-bottom:1px dashed #f1f5f9;">• ${l}</div>`
        ).join('');

        const card = document.createElement('div');
        card.className = 'contract-card';
        // Onclick kirim Array IDs
        card.onclick = () => openContractDetail(group.no_kontrak, group.allIds); 

        card.innerHTML = `
            <div class="card-header">
                <span class="c-type">${group.service_type}</span>
                <span class="c-status active">Active</span>
            </div>
            <div class="c-body">
                <div class="c-row">
                    <i class="ri-file-list-3-line"></i> <strong>${group.no_kontrak}</strong>
                </div>
                
                <div class="c-row" style="align-items: flex-start; margin-top:5px;">
                    <i class="ri-map-pin-line" style="margin-top:2px;"></i> 
                    <div style="max-height: 60px; overflow-y: auto; width: 100%; scrollbar-width: thin;">
                        ${locListHTML}
                    </div>
                </div>

                <div class="c-value" style="margin-top:10px;">
                   Total: ${rp.format(group.totalValue)} /bulan
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ==========================================
// 3. DETAIL KONTRAK & TAGIHAN (FILTER LOKASI)
// ==========================================

function openContractDetail(contractNo, contractIds) {
    // contractIds adalah Array ID (karena one-to-many)
    
    // Cari data kontrak referensi (ambil yang pertama dari group)
    const refContract = contractsDB.find(c => c.no_kontrak === contractNo);
    selectedContract = refContract; // Simpan global (hati-hati, ini hanya referensi 1 row)
    
    // Ganti View
    document.getElementById('client-detail-view').style.display = 'none';
    document.getElementById('contract-detail-view').style.display = 'block';

    // Header Info
    document.getElementById('cd-number').innerText = contractNo;
    document.getElementById('cd-service').innerText = refContract.service_type;
    
    // Generate Billings: Ambil Billing dari SEMUA ID dalam group ini
    let allBillings = [];
    
    // Kumpulkan billing dari setiap ID kontrak (tiap lokasi punya ID kontrak beda)
    contractIds.forEach(id => {
        const bills = billingsDB.filter(b => b.contract_id === id);
        allBillings = allBillings.concat(bills);
    });

    // Urutkan billing (berdasarkan ID periode/tanggal)
    allBillings.sort((a, b) => getMonthYearCode(a.period) - getMonthYearCode(b.period));

    currentBillings = allBillings; // Update global state
    
    // Setup Filter Lokasi
    setupLocationFilter(allBillings);

    renderBillingTable(allBillings);
}

function setupLocationFilter(billings) {
    // Ambil list unik lokasi dari billings
    const uniqueLocs = [...new Set(billings.map(b => b.Location))].filter(l => l);
    
    // Buat Dropdown Filter di HTML (Jika belum ada, inject dinamis)
    let filterContainer = document.getElementById('location-filter-container');
    if(!filterContainer) {
        // Inject filter di atas tabel
        const tableContainer = document.querySelector('.table-responsive');
        const filterHtml = `
            <div id="location-filter-container" style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 12px; font-weight: bold;">Filter Lokasi:</label>
                <select id="filter-location-select" onchange="applyLocationFilter()" style="padding: 5px; border-radius: 4px; border: 1px solid #ccc;">
                    <option value="all">Semua Lokasi</option>
                </select>
            </div>
        `;
        tableContainer.insertAdjacentHTML('beforebegin', filterHtml);
    }
    
    // Isi Option
    const select = document.getElementById('filter-location-select');
    select.innerHTML = '<option value="all">Semua Lokasi</option>';
    uniqueLocs.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.innerText = loc.length > 50 ? loc.substring(0,50)+'...' : loc;
        select.appendChild(opt);
    });
}

function applyLocationFilter() {
    const selectedLoc = document.getElementById('filter-location-select').value;
    
    if (selectedLoc === 'all') {
        renderBillingTable(currentBillings);
    } else {
        const filtered = currentBillings.filter(b => b.Location === selectedLoc);
        renderBillingTable(filtered);
    }
}

// Update Render Table untuk Kolom Lokasi
function renderBillingTable(billings) {
    const tbody = document.getElementById('billing-table-body');
    tbody.innerHTML = '';

    // Update Header Tabel (Inject kolom Lokasi jika belum ada)
    const theadRow = document.querySelector('.erp-table thead tr');
    if (!theadRow.innerHTML.includes('Lokasi')) {
        // Insert Header Lokasi setelah Periode
        const th = document.createElement('th');
        th.innerText = "Lokasi";
        theadRow.insertBefore(th, theadRow.children[1]); // Index 1 setelah checkbox
    }

    if (billings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Tidak ada data tagihan.</td></tr>';
        return;
    }

    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    billings.forEach((b, index) => {
        let statusBadge = '';
        if (b.status === 'Paid') statusBadge = '<span class="badge badge-green">LUNAS</span>';
        else if (b.status === 'Putus') statusBadge = '<span class="badge badge-red">PUTUS</span>';
        else statusBadge = '<span class="badge badge-yellow">UNPAID</span>';

        const row = document.createElement('tr');
        
        // Potong nama lokasi panjang
        const shortLoc = b.Location ? (b.Location.length > 30 ? b.Location.substring(0, 30)+'...' : b.Location) : '-';

        row.innerHTML = `
            <td><input type="checkbox" class="billing-check" value="${b.contract_id}|${b.period}" onchange="updateBulkState()"></td>
            <td>${b.period}</td>
            <td style="font-size: 11px; color: #475569;" title="${b.Location}">${shortLoc}</td> 
            <td>${statusBadge}</td>
            <td>${b.invoice || '-'}</td>
            <td class="text-right">${rp.format(b.amount)}</td>
            <td>
                <button class="btn-icon" onclick="openBillingModal('${index}')"><i class="ri-edit-line"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function closeNewContractModal() {
    document.getElementById('new-contract-modal').classList.add('hidden');
    document.getElementById('client-suggestion-box').classList.add('hidden');
}

// FUNGSI BARU: Mengunci/Membuka Area Detail Kontrak
function toggleContractDetail(enable) {
    const detailSection = document.getElementById('nc-detail-section'); 
    if(!detailSection) return;

    // Kunci/Buka Input
    const inputs = detailSection.querySelectorAll('input, select, textarea, button');

    if (enable) {
        detailSection.classList.remove('section-disabled'); // Hapus efek abu-abu
        inputs.forEach(el => el.disabled = false);
    } else {
        detailSection.classList.add('section-disabled'); // Tambah efek abu-abu
        inputs.forEach(el => el.disabled = true);
    }
}

// 1. LOGIKA PENCARIAN & SUGGESTION CLIENT
// ===============================================
// UPDATE: SMART SEARCH WITH CONTRACT STATUS
// ===============================================

function handleClientSearch(input) {
    const query = input.value.toLowerCase();
    const box = document.getElementById('client-suggestion-box');
    
    // Jika input kurang dari 2 karakter, sembunyikan & reset
    if (query.length < 2) {
        box.classList.add('hidden');
        // Jika input dihapus habis, reset status
        if(query.length === 0) {
            resetClientStatusUI();
            toggleContractDetail(false); 
        }
        return;
    }

    // Cari di database client
    const matches = clientsDB.filter(c => 
        c.name.toLowerCase().includes(query) || 
        String(c.id).toLowerCase().includes(query)
    );

    if (matches.length > 0) {
        box.innerHTML = matches.map(c => `
            <div class="suggestion-item" onclick="selectExistingClient('${c.id}')" style="cursor:pointer; padding:8px; border-bottom:1px solid #f1f5f9; hover:background:#f8fafc;">
                <div style="font-weight:bold; color:#334155; font-size:12px;">${c.name}</div>
                <div style="font-size:10px; color:#64748b;">ID: ${c.id} | ${c.address || '-'}</div>
            </div>
        `).join('');
        
        // Opsi Buat Baru
        box.innerHTML += `
            <div class="suggestion-item" onclick="activateNewClientMode()" style="cursor:pointer; padding:8px; background:#f0f9ff; color:#0288d1; font-weight:bold; font-size:11px; border-top:1px dashed #bae6fd;">
                <i class="ri-add-circle-line"></i> Data tidak ditemukan? Buat Client Baru
            </div>`;
            
        box.classList.remove('hidden');
    } else {
        box.innerHTML = `
            <div class="suggestion-item" onclick="activateNewClientMode()" style="cursor:pointer; padding:10px; text-align:center; color:#0288d1; background:#f0f9ff;">
                <i class="ri-add-circle-line"></i> Client tidak ditemukan. <br><b>Klik untuk buat baru.</b>
            </div>`;
        box.classList.remove('hidden');
    }
}

/**
 * FUNGSI HELPER: CEK KELENGKAPAN KONTRAK
 * Mengembalikan TRUE jika semua field wajib terisi.
 * Mengembalikan FALSE jika ada yang kosong.
 */
function checkContractCompleteness(ctr) {
    // Daftar Field Wajib sesuai request user
    // (id_uniq, client_id(implicit), no_kontrak, is_active, start, end, location, nilai, service, duration, pph)
    
    // Fungsi cek nilai kosong/null/undefined/0
    const isEmpty = (val) => (!val || val === '' || val === '-' || val === 0 || val === '0');

    if (isEmpty(ctr.id_uniq)) return false;
    if (isEmpty(ctr.no_kontrak)) return false;
    // is_active biasanya boolean true/false, jadi cek undefined saja
    if (ctr.is_active === undefined || ctr.is_active === null) return false; 
    
    if (isEmpty(ctr.start_date)) return false;
    if (isEmpty(ctr.end_date)) return false;
    if (isEmpty(ctr.location)) return false;
    
    // Cek Nilai (Pastikan angka > 0)
    const valNilai = parseInt(ctr.nilai || 0);
    if (valNilai <= 0) return false;

    if (isEmpty(ctr.service_type)) return false;
    if (isEmpty(ctr.duration)) return false;
    
    // Cek PPh Preference (Yes/No)
    // Asumsi di object contract key-nya 'pph_preference' (sesuai backend code.gs)
    // Jika backend menyimpannya sebagai 'pph_pref', sesuaikan di sini.
    if (isEmpty(ctr.pph_preference)) return false;

    return true; // Lulus semua cek -> HIJAU
}

// Dipanggil saat klik Existing Client
function selectExistingClient(id, nameFromHtml) {
    // 1. Cari data lengkapnya
    const client = clientsDB.find(c => c.id === id);
    const clientName = client ? client.name : nameFromHtml;

    if (!clientName) return;

    // 2. Set Variable Global
    currentClient = client;

    // 3. Isi Form Identitas
    document.getElementById('nc-client-name').value = clientName;
    document.getElementById('nc-client-id').value = id;
    
    // 4. Update Tampilan Preferensi Pajak
    if(client && client.pph_pref) {
        const pphSelect = document.getElementById('nc-pph-pref');
        if(pphSelect) pphSelect.value = client.pph_pref;
    }

    // 5. Sembunyikan Box Search
    document.getElementById('client-suggestion-box').classList.add('hidden');
    
    // 6. UPDATE STATUS (POIN 2: Perbaiki Tampilan Status)
    if (client) {
        // Panggil render header agar muncul kotak-kotak kontrak
        renderSmartContractListInHeader(client);
    } else {
        // Fallback jika data client belum sync sempurna
        document.getElementById('nc-client-status').innerHTML = 
            `<div class="badge-status-pill active"><i class="ri-check-double-line"></i> TERDAFTAR</div>`;
    }

    // 7. Buka Gembok Form
    toggleContractDetail(true);
}

// Dipanggil saat klik "+ Data tidak ditemukan"
function activateNewClientMode() {
    document.getElementById('client-suggestion-box').classList.add('hidden');
    setClientStatus(true); // Mode Baru
    toggleContractDetail(true); // UNLOCK FORM
    
    // Fokus langsung ke nomor kontrak agar user bisa langsung parse
    setTimeout(() => document.getElementById('nc-contract-no').focus(), 100);
}

function setClientStatus(isNew) {
    isNewClientMode = isNew;
    const statusDiv = document.getElementById('nc-client-status');
    const idInput = document.getElementById('nc-client-id');
    
    if (isNew) {
        statusDiv.innerHTML = `<span class="badge-client badge-new"><i class="ri-star-line"></i> CLIENT BARU</span>`;
        idInput.readOnly = false;
        idInput.value = ''; // Kosongkan agar siap diisi parser
        idInput.placeholder = "Akan terisi dari No Kontrak";
    } else {
        statusDiv.innerHTML = `<span class="badge-client badge-existing"><i class="ri-check-double-line"></i> TERDAFTAR</span>`;
        idInput.readOnly = true;
        idInput.style.background = "#eee";
    }
}

function resetClientStatusUI() {
    // Reset status ke "Menunggu..."
    document.getElementById('nc-client-status').innerHTML = `<span style="color:#94a3b8; font-style:italic; font-size:12px;">Menunggu input nama...</span>`;
    document.getElementById('nc-client-id').value = '';
    document.getElementById('nc-client-id').readOnly = true;
    document.getElementById('nc-client-id').style.background = "#eee";
    
    // Reset global variable jika input nama dikosongkan manual
    if (!document.getElementById('nc-client-name').value) {
        // currentClient = null; // Opsional: Jangan null-kan jika ingin mempertahankan state dashboard
    }
}

// 2. LOGIKA PARSING NOMOR KONTRAK (DIPERBAIKI)
// Format: TK5HE/06097.KB/IX/2025
function parseContractNumber(val) {
    if (!val) return;
    
    // Ubah garis miring atau spasi menjadi array
    const parts = val.split('/');
    
    if (parts.length >= 2) {
        const potentialClientId = parts[0].trim().toUpperCase(); // TK5HE
        const potentialUniqId = parts[1].trim(); // 06097.KB
        
        // A. Selalu isi ID Uniq
        document.getElementById('nc-uniq-id').value = potentialUniqId;

        // B. PERBAIKAN: Selalu paksa isi Client ID jika Mode Client Baru
        //    Ini memperbaiki masalah "ID Client tidak otomatis ambil"
        if (isNewClientMode) {
            const idField = document.getElementById('nc-client-id');
            idField.value = potentialClientId; 
            
            // Animasi visual kecil agar user sadar ID terisi
            idField.style.backgroundColor = "#fff9c4"; 
            setTimeout(() => idField.style.backgroundColor = "white", 500);
        }
    }
}

// 3. LOGIKA TANGGAL
function autoFillEndDate() {
    const startStr = document.getElementById('nc-start-date').value;
    if (!startStr) return;
    const startDate = new Date(startStr);
    const endDate = new Date(startStr);
    endDate.setFullYear(endDate.getFullYear() + 1);
    endDate.setDate(endDate.getDate() - 1);
    document.getElementById('nc-end-date').valueAsDate = endDate;
}

// ==========================================
// FIX 1: LOGIKA SIMPAN KONTRAK (MULTI LOCATION)
// ==========================================


// 1. RENDER DAFTAR KONTRAK DI KOTAK MERAH
// =======================================================
// UPDATE: RENDER DAFTAR KONTRAK (FULL HEADER CHECK)
// =======================================================

function renderSmartContractListInHeader(client) {
    const container = document.getElementById('nc-client-status');
    if (!container) return;
    
    // 1. Reset Container & Tampilkan Status Terdaftar
    container.innerHTML = '';
    
    const statusPill = document.createElement('div');
    statusPill.className = 'badge-status-pill active';
    statusPill.innerHTML = '<i class="ri-check-double-line"></i> TERDAFTAR';
    container.appendChild(statusPill);
    
    // 2. Cek Data Kontrak
    if (!client.contracts || client.contracts.length === 0) {
        const emptyMsg = document.createElement('span');
        emptyMsg.style.fontSize = '10px';
        emptyMsg.style.color = '#94a3b8';
        emptyMsg.style.marginLeft = '5px';
        emptyMsg.innerText = '(Belum ada kontrak)';
        container.appendChild(emptyMsg);
        return;
    }

    // 3. Buat Wrapper List
    const listDiv = document.createElement('div');
    listDiv.className = 'sc-list-wrapper'; 
    
    // 4. Loop & Buat Tombol Interaktif
    client.contracts.forEach(ctr => {
        // === LOGIKA BARU: CEK KELENGKAPAN HEADER (STRICT) ===
        // Agar hijau, data header harus lengkap: No, Service, Tgl Mulai, Tgl Akhir, Nilai, Lokasi
        
        const hasNo = ctr.no_kontrak && ctr.no_kontrak !== '-';
        const hasService = ctr.service_type && ctr.service_type !== '';
        const hasStart = ctr.start_date && ctr.start_date !== '';
        const hasEnd = ctr.end_date && ctr.end_date !== '';
        const hasLoc = ctr.location && ctr.location !== '';
        
        // Cek Nilai (Pastikan angka > 0)
        const valNum = parseInt(String(ctr.nilai || 0).replace(/[^0-9]/g, ''));
        const hasVal = valNum > 0;

        // Tentukan Status Lengkap
        const isComplete = (hasNo && hasService && hasStart && hasEnd && hasLoc && hasVal);
        
        const btn = document.createElement('div');
        // Styling berdasarkan status (sc-ok = Hijau/Lengkap, sc-warn = Orange/Belum Lengkap)
        btn.className = isComplete ? 'sc-item-btn sc-ok' : 'sc-item-btn sc-warn';
        
        // Icon & Label
        const icon = isComplete ? '<i class="ri-checkbox-circle-line"></i>' : '<i class="ri-alert-line"></i>';
        const label = ctr.no_kontrak || ctr.id_uniq || 'No-ID';
        
        btn.innerHTML = `${icon} ${label}`;
        btn.title = isComplete ? "Data Header Lengkap (Klik untuk Load)" : "Data Belum Lengkap";
        
        // Event Listener: Load data ke form saat diklik
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation(); 
            loadContractToForm(ctr);
        });
        
        listDiv.appendChild(btn);
    });

    container.appendChild(listDiv);
}

// FUNGSI TAMBAH BARIS (SUPPORT ISI VALUE OTOMATIS)
function addLocationRow(preLocation = '', preValue = '') {
    const container = document.getElementById('multi-loc-container');
    if(!container) return;

    const id = Date.now() + Math.floor(Math.random()*1000); 
    
    const rowHtml = `
        <div class="multi-row" id="row-${id}" style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
            <div style="flex: 2;">
                <input type="text" class="form-input multi-loc-name" placeholder="Nama Lokasi / Cabang" value="${preLocation}" style="font-size: 11px; font-weight:600; color:#334155;">
            </div>
            <div style="flex: 1;">
                <input type="text" class="form-input currency-input multi-loc-val" placeholder="Rp Nilai" value="${preValue}" onkeyup="formatInputCurrency(this); updateMultiTotal()" style="font-size: 11px; text-align:right;">
            </div>
            <button onclick="removeLocationRow('${id}')" style="background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 4px; cursor: pointer; padding: 4px 8px; height: 32px; display:flex; align-items:center;" title="Hapus Baris">
                <i class="ri-delete-bin-line"></i>
            </button>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', rowHtml);
}

// 3. CEK KELENGKAPAN DATA (LOGIKA MERAH/HIJAU)
function checkCompletenessStrict(ctr) {
    // Fungsi cek kosong
    const isE = (v) => (!v || v === '' || v === '-' || v === 0 || v === '0');

    // 1. Cek ID & No Kontrak
    if (isE(ctr.id_uniq)) return false;
    if (isE(ctr.no_kontrak)) return false;
    
    // 2. Cek Tanggal
    if (isE(ctr.start_date)) return false;
    if (isE(ctr.end_date)) return false;
    
    // 3. Cek Lokasi & Service
    if (isE(ctr.location)) return false;
    if (isE(ctr.service_type)) return false;
    
    // 4. Cek Nilai (Support variasi nama kolom: 'nilai' atau '#_nilai')
    const valNilai = parseInt(ctr.nilai || ctr['#_nilai'] || 0);
    if (valNilai <= 0) return false;

    // 5. Cek PPh (Support variasi: 'pph_preference', 'pph23', atau 'pph_pref')
    // Di sheet Anda headernya "PPh23", jadi objectnya 'pph23'
    const pphVal = ctr.pph_preference || ctr.pph23 || ctr.pph_pref;
    if (isE(pphVal)) return false;

    return true; // Hijau jika semua lolos

} 
  // ==========================================
// FITUR CLIENT GROUP / MEMBERS (REVISI FIX)
// ==========================================

// 1. HELPER: Cari ID Teman Segrup (Safe Mode)
function getConnectedClients(clientId) {
    // 1. Cek Data Kosong
    if (!clientGroupsRaw || clientGroupsRaw.length === 0) {
        console.warn("Client Groups data kosong (Belum diload dari Sheet).");
        return [clientId];
    }

    // 2. Normalisasi ID Client saat ini (Hapus spasi, uppercase)
    const currentIdClean = String(clientId).trim().toUpperCase();

    // 3. Cari Baris Group yang COCOK
    const groupRow = clientGroupsRaw.find(row => {
        if (!row.member_ids) return false;
        
        // Ubah isi cell menjadi string, uppercase, lalu cek apakah mengandung ID kita
        const membersStr = String(row.member_ids).toUpperCase();
        
        // Kita pecah dulu jadi array biar pencarian akurat (menghindari 'A1' match dengan 'A10')
        // Split berdasarkan koma, lalu trim setiap item
        const membersArr = membersStr.split(',').map(m => m.trim());
        
        return membersArr.includes(currentIdClean);
    });

    // 4. Jika Ketemu, Kembalikan Array Teman-temannya
    if (groupRow) {
        console.log("Group Ditemukan:", groupRow);
        // Return array ID bersih
        return String(groupRow.member_ids).split(',').map(id => id.trim());
    }
    
    // 5. Jika Tidak Ketemu, Return Diri Sendiri
    console.log("Client ini tidak punya group.");
    return [clientId];
}

// 2. BUKA HALAMAN MEMBERS (Fungsi Utama)
function openClientGroupView() {
    console.log("Membuka Group View..."); 
    if (!currentClient) { alert("Error: Data Client belum dipilih!"); return; }

    // --- TAMBAHAN BARU: Simpan State ---
    viewMode = 'group'; 
    saveAppState(); 
    // -----------------------------------

    // A. Siapkan Data
    let groupIds = [];
    try {
        groupIds = getConnectedClients(currentClient.id);
    } catch (e) {
        console.error("Gagal mengambil koneksi:", e);
        groupIds = [currentClient.id];
    }
    currentGroupMembers = groupIds; 
    // B. Reset Filter State ...
    // C. Render Layout ...
    
    // B. Reset Filter State
    groupFilterState = {
        status: 'unpaid',
        location: '',
        period: '',
        selectedIds: [...groupIds],
        sort: 'desc',
        dateRec: '',
        datePay: ''
    };

    // C. Render Layout Full Page
    const container = document.getElementById('app-container');
    document.body.classList.remove('mode-fixed'); 

    container.innerHTML = `
        <div class="group-view-wrapper">
            <div style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h2 style="color:#512da8; display:flex; align-items:center; gap:10px; margin-bottom:5px;">
                        <i class="ri-team-fill"></i> Client Members Group
                    </h2>
                    <div style="font-size:13px; color:#546e7a;">
                        Terhubung: <b>${groupIds.length} Client</b> (Termasuk ${currentClient.name})
                    </div>
                </div>
                
                <button onclick="closeGroupView()" style="background:white; border:1px solid #cfd8dc; padding:8px 15px; border-radius:6px; cursor:pointer; color:#546e7a; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                    <i class="ri-arrow-left-line"></i> Kembali
                </button>
            </div>

            <div class="group-filter-bar">
                <div class="gf-item">
                    <label class="gf-label">Status</label>
                    <select id="gf-status" class="gf-input" onchange="updateGroupFilter('status', this.value)">
                        <option value="unpaid">Unpaid (Hutang)</option>
                        <option value="paid">Paid (Lunas)</option>
                        <option value="dispute">Dispute</option>
                    </select>
                </div>

                <div class="gf-item">
                    <label class="gf-label">Filter Client (Checklist)</label>
                    <div class="multiselect-dropdown" id="ms-client-dropdown">
                        <div class="ms-select-btn" onclick="toggleMsDropdown()">
                            <span id="ms-label-text">Pilih Client...</span>
                            <i class="ri-arrow-down-s-line"></i>
                        </div>
                        <div class="ms-options" id="ms-client-options"></div>
                    </div>
                </div>

                <div class="gf-item">
                    <label class="gf-label">Lokasi Kerja</label>
                    <input type="text" id="gf-location" class="gf-input" placeholder="Cari Lokasi..." onkeyup="updateGroupFilter('location', this.value)">
                </div>

                <div class="gf-item">
                    <label class="gf-label">Periode (Bulan)</label>
                    <input type="month" id="gf-period" class="gf-input" onchange="updateGroupFilter('period', this.value)">
                </div>

                <div class="gf-item">
                    <label class="gf-label">Urutkan Umur</label>
                    <select id="gf-sort" class="gf-input" onchange="updateGroupFilter('sort', this.value)">
                        <option value="desc">Tua > Muda</option>
                        <option value="asc">Muda > Tua</option>
                    </select>
                </div>

                <div class="gf-item" id="gf-wrap-rec">
                    <label class="gf-label">Tgl Tanda Terima</label>
                    <select id="gf-date-rec" class="gf-input" onchange="updateGroupFilter('dateRec', this.value)" style="min-width:140px; cursor:pointer;">
                        <option value="">-- Semua Tanggal --</option>
                    </select>
                </div>
                
                <div class="gf-item hidden" id="gf-wrap-pay" style="display:none;">
                    <label class="gf-label">Tgl Bayar</label>
                    <select id="gf-date-pay" class="gf-input" onchange="updateGroupFilter('datePay', this.value)" style="min-width:140px; cursor:pointer;">
                        <option value="">-- Semua Tanggal --</option>
                    </select>
                </div>

                <div style="margin-left:auto; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                    <button class="btn-add-conn" onclick="openAddConnectionModal()">
                        <i class="ri-link"></i> Tambah Koneksi
                    </button>
                    <button id="btnGroupBulkPay" class="bulk-action-btn" onclick="openBulkPayModal()" style="height:34px; font-size:11px;">
                        <i class="ri-checkbox-multiple-line"></i> Bayar Sekaligus <span id="bulkCount" class="bulk-count-badge">0</span>
                    </button>
                </div>
            </div>

            <div id="group-table-container" class="billing-container" style="background:white; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.05); overflow:hidden; min-height:300px;">
                </div>
        </div>
    `;

    // 1. Render Checklist Client
    renderMsChecklist();
    
    // 2. [BARU] Populate Opsi Tanggal dari Database
    populateGroupDateOptions();

    // 3. Render Tabel Utama
    renderGroupTable();
}

// Fungsi untuk tombol KEMBALI dari halaman Group
function closeGroupView() {
    viewMode = 'grid'; // Reset ke tampilan Grid
    saveAppState();
    renderClientProfile(currentClient);
}

// HELPER BARU: Mengisi Dropdown Tanggal dari Data Database
function populateGroupDateOptions() {
    const recSelect = document.getElementById('gf-date-rec');
    const paySelect = document.getElementById('gf-date-pay');
    
    // Set (Himpunan) untuk menyimpan tanggal unik (menghindari duplikat)
    const recDates = new Set();
    const payDates = new Set();

    // Loop semua client di grup
    currentGroupMembers.forEach(id => {
        const client = clientsDB.find(c => c.id === id);
        if (!client) return;

        client.contracts.forEach(ctr => {
            ctr.billings.forEach(bill => {
                // Ambil Tanggal Terima
                if (bill.received_date) {
                    // Format YYYY-MM-DD untuk value
                    const isoDate = formatDateInput(bill.received_date); 
                    if(isoDate) recDates.add(isoDate);
                }
                // Ambil Tanggal Bayar
                if (bill.paid_date) {
                    const isoDate = formatDateInput(bill.paid_date);
                    if(isoDate) payDates.add(isoDate);
                }
            });
        });
    });

    // Urutkan Tanggal (Terbaru ke Terlama)
    const sortedRec = Array.from(recDates).sort((a, b) => new Date(b) - new Date(a));
    const sortedPay = Array.from(payDates).sort((a, b) => new Date(b) - new Date(a));

    // Helper membuat opsi HTML
    const createOptions = (dates) => {
        let opts = '<option value="">-- Semua Tanggal --</option>';
        dates.forEach(dateStr => {
            // Tampilan: DD/MM/YYYY
            const displayDate = new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
            opts += `<option value="${dateStr}">${displayDate}</option>`;
        });
        return opts;
    };

    // Isi ke HTML Select
    if(recSelect) recSelect.innerHTML = createOptions(sortedRec);
    if(paySelect) paySelect.innerHTML = createOptions(sortedPay);
}

// 3. LOGIKA DROPDOWN CHECKLIST
function renderMsChecklist() {
    const container = document.getElementById('ms-client-options');
    let html = `
        <div class="ms-option-item" onclick="toggleAllGroupClients(true)" style="border-bottom:1px solid #eee; background:#f5f5f5;">
            <i class="ri-check-double-line" style="color:var(--accent-teal)"></i> <strong>Pilih Semua</strong>
        </div>
        <div class="ms-option-item" onclick="toggleAllGroupClients(false)" style="border-bottom:1px solid #eee;">
            <i class="ri-close-line" style="color:#ef5350"></i> <span>Reset (Kosongkan)</span>
        </div>
    `;

    currentGroupMembers.forEach(id => {
        const clientData = clientsDB.find(c => c.id === id);
        const name = clientData ? clientData.name : '(ID Tidak Ditemukan)';
        const isChecked = groupFilterState.selectedIds.includes(id) ? 'checked' : '';
        
        html += `
            <div class="ms-option-item" onclick="toggleGroupClientCheckbox('${id}')">
                <input type="checkbox" id="chk-g-${id}" ${isChecked} style="pointer-events:none;"> 
                <div style="display:flex; flex-direction:column; margin-left:8px;">
                    <span style="font-weight:700; color:#455a64; font-size:11px;">${name}</span>
                    <span style="font-size:9px; color:#90a4ae;">ID: ${id}</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
    updateMsLabel();
}

function toggleMsDropdown() {
    const el = document.getElementById('ms-client-options');
    el.classList.toggle('show');
}

// Tutup dropdown jika klik diluar
window.addEventListener('click', function(e){   
    if (!document.getElementById('ms-client-dropdown').contains(e.target)){
        const opts = document.getElementById('ms-client-options');
        if(opts) opts.classList.remove('show');
    }
});

function toggleGroupClientCheckbox(id) {
    if (groupFilterState.selectedIds.includes(id)) {
        groupFilterState.selectedIds = groupFilterState.selectedIds.filter(x => x !== id);
    } else {
        groupFilterState.selectedIds.push(id);
    }
    const chk = document.getElementById(`chk-g-${id}`);
    if(chk) chk.checked = groupFilterState.selectedIds.includes(id);
    updateMsLabel();
    renderGroupTable();
}

function toggleAllGroupClients(check) {
    groupFilterState.selectedIds = check ? [...currentGroupMembers] : [];
    renderMsChecklist(); 
    renderGroupTable();
}

function updateMsLabel() {
    const count = groupFilterState.selectedIds.length;
    const total = currentGroupMembers.length;
    document.getElementById('ms-label-text').innerText = count === total ? 'Semua Client' : `${count} Client Dipilih`;
}

// 4. FILTER & AGREGASI DATA
function updateGroupFilter(key, val) {
    groupFilterState[key] = val;
    if (key === 'status') {
        const wrapPay = document.getElementById('gf-wrap-pay');
        if (val === 'paid') wrapPay.style.display = 'flex';
        else wrapPay.style.display = 'none';
    }
    renderGroupTable();
}

function getAggregatedData() {
    let aggregated = [];
    const today = new Date();

    // 1. Kumpulkan semua data dari member
    groupFilterState.selectedIds.forEach(id => {
        const client = clientsDB.find(c => c.id === id);
        if (!client) return;

        client.contracts.forEach(contract => {
            contract.billings.forEach(bill => {
                let realStatus = bill.status;
                if (bill.status === 'Paid' && !bill.paid_date) realStatus = 'Unpaid';

                let age = 0;
                if (bill.received_date) {
                    age = Math.ceil(Math.abs(today - new Date(bill.received_date)) / 86400000);
                }

                let pvsaDisplay = '-';
                if (realStatus === 'Paid' && bill.received_date && bill.paid_date) {
                    const diff = Math.ceil((new Date(bill.paid_date) - new Date(bill.received_date)) / 86400000);
                    pvsaDisplay = diff + ' Hari';
                }

                aggregated.push({
                    ...bill,
                    clientId: client.id,
                    clientName: client.name,
                    location: contract.location || '-',
                    contractId: contract.id_uniq, 
                    realStatus: realStatus,
                    ageDays: age,
                    pvsaDisplay: pvsaDisplay
                });
            });
        });
    });

    const { status, location, period, sort, dateRec, datePay } = groupFilterState;

    // 2. FILTER STATUS
    if (status === 'unpaid') {
        aggregated = aggregated.filter(b => (b.realStatus === 'Unpaid') && b.status !== 'Cancel' && b.status !== 'Pemutihan' && b.status !== 'Empty');
    } else if (status === 'paid') {
        aggregated = aggregated.filter(b => b.realStatus === 'Paid');
    } else if (status === 'dispute') {
        aggregated = aggregated.filter(b => b.realStatus === 'Dispute');
    }

    // 3. FILTER LAINNYA
    if (location) {
        aggregated = aggregated.filter(b => b.location.toLowerCase().includes(location.toLowerCase()));
    }

    if (period) {
        const [y, m] = period.split('-');
        aggregated = aggregated.filter(b => {
            if(!b.period) return false;
            const d = new Date(b.period);
            if(isNaN(d.getTime())) return false; 
            return d.getFullYear() == y && (d.getMonth() + 1) == m;
        });
    }

    // 4. FILTER TANGGAL (DROPDOWN DB)
    // Logika ini sudah support karena value dropdown adalah YYYY-MM-DD
    if (dateRec) aggregated = aggregated.filter(b => formatDateInput(b.received_date) === dateRec);
    if (datePay && status === 'paid') aggregated = aggregated.filter(b => formatDateInput(b.paid_date) === datePay);

    // 5. SORTING
    aggregated.sort((a, b) => {
        const dateA = new Date(a.received_date || a.date || '2099-01-01');
        const dateB = new Date(b.received_date || b.date || '2099-01-01');
        return sort === 'desc' ? (dateA - dateB) : (dateB - dateA);
    });

    return aggregated;
}

// 5. RENDER TABEL (Dinamis Sesuai Permintaan)
// =======================================================
// UPDATE: RENDER GROUP TABLE (ENABLE EDIT)
// =======================================================

function renderGroupTable() {
    const data = getAggregatedData();
    const container = document.getElementById('group-table-container');
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
    const status = groupFilterState.status;

    // Reset Bulk Pay
    selectedBulkItems = [];
    updateBulkButtonUI();

    // Tambahkan kolom AKSI di header
    let extraHeads = '';
    if (status === 'unpaid') extraHeads = `<th width="10%">Harga</th><th width="10%">Umur</th>`;
    else if (status === 'paid') extraHeads = `<th width="10%">Harga</th><th width="10%">Nilai Bayar</th><th width="8%">PVSA</th>`;
    else if (status === 'dispute') extraHeads = `<th width="10%">Harga</th><th width="20%">Keterangan</th>`;

    const headerHtml = `
        <thead>
            <tr>
                <th width="3%" style="text-align:center;"><input type="checkbox" onchange="toggleSelectAll(this)"></th>
                <th width="15%">Lokasi Kerja</th>
                <th width="10%">Periode</th>
                <th width="12%">Faktur / Invoice</th>
                <th width="15%">Nama Client</th>
                <th width="12%">Tgl (Terbit / Trm)</th>
                ${extraHeads}
                <th width="5%" style="text-align:center">Aksi</th>
            </tr>
        </thead>
    `;

    if (data.length === 0) {
        container.innerHTML = `<table class="erp-table">${headerHtml}<tbody><tr><td colspan="11" style="text-align:center; padding:30px; color:#90a4ae;">Tidak ada data sesuai filter.</td></tr></tbody></table>`;
        return;
    }

    const rows = data.map(item => {
        const chkVal = `${item.contractId}|${item.period}|${item.amount}|${item.realStatus}`;
        const checkBox = `<input type="checkbox" class="chk-row" value="${chkVal}" onchange="toggleSelectRow(this)">`;

        let extraCols = '';
        if (status === 'unpaid') {
            const color = item.ageDays > 60 ? '#ef5350' : (item.ageDays > 30 ? '#ffb74d' : '#64b5f6');
            extraCols = `<td style="font-weight:bold;">${rp.format(item.amount)}</td><td><span style="color:${color}; font-weight:bold;">${item.ageDays} Hari</span></td>`;
        } else if (status === 'paid') {
            extraCols = `<td style="font-weight:bold; color:#78909c;">${rp.format(item.amount)}</td><td style="font-weight:bold; color:#2e7d32;">${rp.format(item.amount)}</td><td>${item.pvsaDays} Hari</td>`;
        } else if (status === 'dispute') {
            extraCols = `<td style="font-weight:bold;">${rp.format(item.amount)}</td><td><div style="font-size:11px; font-style:italic;">${item.note || '-'}</div></td>`;
        }

        // [UPDATE] ARGUMEN TOMBOL EDIT
        // Kirim item.clientId agar openPanel bisa switch context
        const safeLoc = item.location ? item.location.replace(/"/g, '&quot;').replace(/'/g, "\\'") : '';
        const onClickArgs = `'${item.contractId}', null, '${item.period}', null, '${safeLoc}', '${item.clientId}'`;

        return `
            <tr>
                <td style="text-align:center;">${checkBox}</td>
                <td>
                    <div style="font-size:11px; font-weight:600; color:#455a64;">${item.location}</div>
                </td>
                <td style="font-weight:bold;">${formatPeriod(item.period)}</td>
                <td>
                    <div class="cell-stack">
                        <span class="txt-sub">${item.faktur || '-'}</span>
                        <span class="txt-main" style="color:var(--accent-teal)">${item.invoice || '-'}</span>
                    </div>
                </td>
                <td>
                    <span class="client-badge-row">${item.clientId}</span>
                    <div style="font-size:12px; font-weight:600; color:#37474f;">${item.clientName}</div>
                </td>
                <td>
                    <div class="cell-stack">
                        <span class="txt-sub">T: ${formatDate(item.date)}</span>
                        <span class="txt-main">R: ${formatDate(item.received_date)}</span>
                    </div>
                </td>
                ${extraCols}
                <td style="text-align:center;">
                    <button class="btn-icon" onclick="openPanel(${onClickArgs})"><i class="ri-edit-box-line"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `<table class="erp-table">${headerHtml}<tbody>${rows}</tbody></table>`;
}

// 6. BUTTON TAMBAH KONEKSI
// ==========================================
// UPDATE: MODAL TAMBAH KONEKSI (SEARCH UI)
// ==========================================

function openAddConnectionModal() {
    const modal = document.getElementById('risk-modal'); 
    const container = document.getElementById('risk-list-container');
    const title = document.getElementById('risk-modal-title');
    
    // 1. Setup Header Modal
    title.innerHTML = `<i class="ri-link"></i> Tambah Koneksi Client`;
    
    // 2. Render UI Pencarian di dalam Modal
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <p style="color:#546e7a; font-size:13px; margin-bottom:10px;">
                Cari Client lain untuk dihubungkan dengan <b>${currentClient.name}</b>. 
                Data tagihan mereka akan digabungkan dalam tampilan Group ini.
            </p>
            
            <div style="position:relative;">
                <i class="ri-search-line" style="position:absolute; left:12px; top:10px; color:#90a4ae;"></i>
                <input type="text" id="conn-search-input" 
                    placeholder="Ketik Nama atau ID Client..." 
                    onkeyup="searchConnectionCandidates(this.value)"
                    style="width:100%; padding:10px 10px 10px 35px; border:1px solid #cfd8dc; border-radius:6px; font-weight:bold; color:#37474f; outline:none;">
            </div>
        </div>

        <div id="conn-search-results" style="max-height:300px; overflow-y:auto; border-top:1px dashed #eee; padding-top:10px;">
            <div style="text-align:center; color:#cfd8dc; padding:20px; font-size:12px;">
                <i class="ri-search-eye-line" style="font-size:24px;"></i><br>
                Hasil pencarian akan muncul di sini
            </div>
        </div>
        
        <div style="text-align:right; margin-top:15px; pt-10; border-top:1px solid #eee;">
            <button onclick="closeRiskModal()" style="background:#f5f5f5; color:#546e7a; border:1px solid #cfd8dc; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">Batal</button>
        </div>
    `;

    // 3. Tampilkan Modal
    modal.classList.remove('hidden');
    
    // Auto focus ke input agar user langsung bisa ketik
    setTimeout(() => {
        const inp = document.getElementById('conn-search-input');
        if(inp) inp.focus();
    }, 100);
}

function searchConnectionCandidates(keyword) {
    const container = document.getElementById('conn-search-results');
    const query = keyword.toLowerCase().trim();

    if (query.length < 2) {
        container.innerHTML = `<div style="text-align:center; color:#cfd8dc; padding:20px; font-size:12px;">Ketik minimal 2 karakter...</div>`;
        return;
    }

    // FILTER LOGIC:
    // 1. Cocokkan Nama atau ID dengan keyword
    // 2. JANGAN tampilkan diri sendiri (currentClient) -> Mencegah error
    // 3. JANGAN tampilkan client yang SUDAH ada di group (currentGroupMembers) -> Mencegah duplikat
    const matches = clientsDB.filter(c => {
        const matchName = c.name.toLowerCase().includes(query);
        const matchId = String(c.id).toLowerCase().includes(query);
        const isNotSelf = c.id !== currentClient.id;
        const isNotMember = !currentGroupMembers.includes(c.id);
        
        return (matchName || matchId) && isNotSelf && isNotMember;
    });

    if (matches.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#ef5350; padding:20px; font-size:12px;">Tidak ditemukan client (yang belum tergabung) dengan kata kunci tersebut.</div>`;
        return;
    }

    // RENDER HASIL LIST
    container.innerHTML = matches.map(c => `
        <div onclick="submitConnectionRequest('${c.id}', '${c.name.replace(/'/g, "\\'")}')" 
             style="display:flex; align-items:center; justify-content:space-between; padding:10px; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.2s;" 
             onmouseover="this.style.background='#f0f9ff'" 
             onmouseout="this.style.background='transparent'">
            
            <div>
                <div style="font-weight:bold; color:#37474f; font-size:12px;">${c.name}</div>
                <div style="font-size:10px; color:#64748b;">ID: ${c.id} | ${c.address || '-'}</div>
            </div>
            
            <button style="background:#e8f5e9; color:#2e7d32; border:1px solid #c8e6c9; border-radius:4px; padding:4px 8px; font-size:10px; cursor:pointer;">
                <i class="ri-add-line"></i> PILIH
            </button>
        </div>
    `).join('');
}

function submitConnectionRequest(targetId, targetName) {
    if(!confirm(`Tambahkan "${targetName}" (ID: ${targetId}) ke dalam group ini?\n\nKoneksi ini akan menggabungkan data tagihan kedua client.`)) return;

    // UI Loading di dalam Modal agar user tahu sedang proses
    const container = document.getElementById('conn-search-results');
    if(container) {
        container.innerHTML = `<div style="text-align:center; padding:30px;"><i class="ri-loader-4-line ri-spin" style="font-size:30px; color:var(--accent-teal);"></i><br>Sedang memproses request ke server...</div>`;
    }

    // [PERBAIKAN LOGIKA]
    // Backend Google Script mengharapkan action 'add_connection' dengan parameter 'origin_id' dan 'target_query'.
    // Kita kirimkan ID hasil pencarian ke 'target_query', backend akan otomatis mencocokkan ID tersebut.
    
    const payload = {
        action: 'add_connection',    // Gunakan action yang sudah ada di Backend
        origin_id: currentClient.id, // ID Client yang sedang dibuka
        target_query: targetId       // Kirim ID Target sebagai query pencarian
    };

    // Kirim ke Backend
    sendData(payload);
    
    // Tutup modal (sendData akan otomatis reload halaman setelah sukses)
    closeRiskModal();
}
// [UPDATE D] EKSEKUSI BATAL BAYAR (UNDO)
function triggerBulkUndo() {
    if (selectedBulkItems.length === 0) return;

    if(!confirm(`⚠️ KONFIRMASI PEMBATALAN\n\nAnda akan membatalkan status LUNAS untuk ${selectedBulkItems.length} tagihan terpilih.\nTagihan akan kembali menjadi UNPAID dan tanggal bayar dihapus.\n\nLanjutkan?`)) return;

    // Siapkan Payload
    const items = selectedBulkItems.map(raw => {
        const parts = raw.split('|');
        return { contract_id: parts[0], period: parts[1] };
    });

    const payload = {
        action: 'bulk_undo_payment',
        items: items
    };

    // UI Loading (Cari tombol yang aktif)
    const btn = document.querySelector('.bulk-action-btn.active');
    if(btn) { 
        btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Memproses...'; 
        btn.disabled = true; 
    }

    sendData(payload).then(() => {
        // Reset selection setelah sukses
        selectedBulkItems = [];
    });
}

// =======================================================
// FUNGSI BARU: LOAD KONTRAK EKSISTING KE FORM (SINGLE & MULTI)
// =======================================================
// =======================================================
// UPDATE: LOAD KONTRAK EKSISTING KE FORM (FIX LOGIKA ID)
// =======================================================
function loadContractToForm(ctr) {
    console.log("Load Contract:", ctr);

    if(!confirm(`Load data kontrak ${ctr.no_kontrak}?\nSistem akan mengambil data header dan SEMUA lokasi yang terdaftar.`)) return;

    // 1. ISI FIELD HEADER (Data Induk)
    document.getElementById('nc-contract-no').value = ctr.no_kontrak;
    // ID Unik header (Untuk display saja di mode Multi, tapi penting di mode Single)
    document.getElementById('nc-uniq-id').value = ctr.id_uniq || ''; 
    
    // Dropdown Service
    const selectService = document.getElementById('nc-service-type');
    if(selectService) selectService.value = ctr.service_type || 'Insect & Rodent';

    // Tanggal (Handle format tanggal dengan aman)
    if(ctr.start_date) document.getElementById('nc-start-date').value = formatDateInput(ctr.start_date);
    if(ctr.end_date) document.getElementById('nc-end-date').value = formatDateInput(ctr.end_date);
    
    // PPh Preference
    const pphSelect = document.getElementById('nc-pph-pref');
    const pphVal = ctr.pph_preference || ctr.pph23 || ctr.pph_pref || 'No';
    if(pphSelect) pphSelect.value = pphVal;

    // Nilai & Lokasi (Untuk Mode Single - Jaga-jaga)
    const valStr = parseInt(ctr.nilai || 0).toLocaleString('id-ID');
    const locStr = ctr.location || '';
    document.getElementById('nc-amount').value = valStr;
    document.getElementById('nc-location').value = locStr;

    // 2. AKTIFKAN MODE MULTI LOKASI SECARA OTOMATIS
    const radioMulti = document.querySelector('input[name="contractMode"][value="multi"]');
    if(radioMulti) {
        radioMulti.checked = true;
        // Trigger perubahan UI (show/hide div yang sesuai)
        toggleContractMode(); 
    }

    // 3. CARI & RENDER SEMUA LOKASI (SIBLINGS)
    // Cari semua kontrak di database client ini yang nomor kontraknya SAMA
    const siblings = currentClient.contracts.filter(c => 
        String(c.no_kontrak).trim() === String(ctr.no_kontrak).trim()
    );

    const multiContainer = document.getElementById('multi-loc-container');
    if(multiContainer) {
        multiContainer.innerHTML = ''; // Reset container agar tidak numpuk
        
        if (siblings.length > 0) {
            // Loop setiap lokasi yang ditemukan dan masukkan ke form
            siblings.forEach(sib => {
                const sVal = sib.nilai; // Biarkan raw, nanti diformat di addLocationRow
                const sLoc = sib.location || '';
                const sId = sib.id_uniq || ''; // INI KUNCINYA: Ambil ID lama (misal: 00347.KP)
                
                // Kirim ID ke fungsi addLocationRow agar tersimpan di hidden input
                addLocationRow(sLoc, sVal, sId);
            });
        } else {
            // Fallback (Data kontrak yg diklik saja jika tidak ada siblings)
            addLocationRow(ctr.location || '', ctr.nilai || 0, ctr.id_uniq || '');
        }
        
        // Update Total Nilai di UI
        updateMultiTotal();
    }

    // 4. VISUAL FEEDBACK (Kuning sebentar)
    const formBody = document.querySelector('.modal-body-scrollable') || document.querySelector('.modal-body');
    if(formBody) {
        const originalBg = formBody.style.backgroundColor;
        formBody.style.transition = 'background-color 0.3s ease';
        formBody.style.backgroundColor = '#fff9c4'; 
        setTimeout(() => { 
            formBody.style.backgroundColor = originalBg || '#f8fafc'; 
        }, 600);
    }
}