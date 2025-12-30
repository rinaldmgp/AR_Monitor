/**
 * contract_input.js
 * Modul terpisah untuk input kontrak baru
 */

function renderInputContractPage() {
    const container = document.getElementById('app-container');
    const title = document.getElementById('page-title');
    
    // Matikan fixed mode scroll
    document.body.classList.remove('mode-fixed');

    // Update menu aktif
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
    // Cari menu ke-3 (Dokumen Kontrak) dan aktifkan
    const menuItems = document.querySelectorAll('.menu-item');
    if(menuItems[2]) menuItems[2].classList.add('active');

    title.innerText = "Input Dokumen Kontrak";

    container.innerHTML = `
    <div class="input-contract-wrapper">
        
        <div style="background:white; padding:20px; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,0.05); margin-bottom:20px; text-align:center;">
            <div style="font-size:18px; font-weight:800; color:#1f3045;">FORMULIR KONTRAK BARU</div>
            <div style="font-size:12px; color:#78909c;">Pastikan data sudah benar sebelum disimpan.</div>
        </div>

        <div class="form-card">
            <div class="fc-header"><i class="ri-file-text-line"></i> Identitas & Parsing</div>
            <div class="fc-body">
                <div class="form-group">
                    <label class="form-label">Nomor Kontrak (Full)</label>
                    <div style="display:flex; gap:10px;">
                        <input type="text" id="in-full-contract" class="form-input big-input" 
                               placeholder="Contoh: TK5HE/06097.KB/IX/2025" 
                               onkeyup="parseContractNumber()">
                        <div id="parse-status" class="parse-badge pending">Menunggu Input...</div>
                    </div>
                </div>
                <div class="parsed-grid">
                    <div class="p-item"><label>Client ID (Prefix)</label><input type="text" id="in-client-id" class="p-input" readonly></div>
                    <div class="p-item"><label>Unique ID (Middle)</label><input type="text" id="in-uniq-id" class="p-input" readonly></div>
                </div>
            </div>
        </div>

        <div class="form-card">
            <div class="fc-header"><i class="ri-building-4-line"></i> Data Pelanggan</div>
            <div class="fc-body">
                <div class="form-group" style="position:relative;">
                    <label class="form-label">Nama Pelanggan</label>
                    <input type="text" id="in-client-name" class="form-input" 
                           placeholder="Ketik nama pelanggan..." autocomplete="off" onkeyup="handleClientSuggest(this)">
                    <div id="client-suggestions" class="suggestions-box hidden"></div>
                </div>
                <div class="grid-2">
                    <div class="form-group"><label class="form-label">Alamat Lengkap</label><textarea id="in-client-address" class="form-input" rows="3"></textarea></div>
                    <div class="form-group"><label class="form-label">Lokasi Kerja</label><textarea id="in-work-location" class="form-input" rows="3" placeholder="Nama Lokasi || Alamat"></textarea></div>
                </div>
                <div class="grid-3">
                    <div class="form-group"><label class="form-label">PIC Name</label><input type="text" id="in-pic" class="form-input"></div>
                    <div class="form-group"><label class="form-label">Phone / WA</label><input type="text" id="in-phone" class="form-input"></div>
                    <div class="form-group"><label class="form-label">Email</label><input type="text" id="in-email" class="form-input"></div>
                </div>
                <div class="grid-2">
                    <div class="form-group"><label class="form-label">Payment Method</label>
                        <select id="in-payment" class="form-input">
                            <option value="VA Open Payment">VA Open Payment</option>
                            <option value="VA Closed Payment">VA Closed Payment</option>
                            <option value="Transfer Bank">Transfer Bank</option>
                        </select>
                    </div>
                    <div class="form-group"><label class="form-label">VA Number</label><input type="text" id="in-va" class="form-input"></div>
                </div>
            </div>
        </div>

        <div class="form-card">
            <div class="fc-header"><i class="ri-briefcase-line"></i> Detail Layanan</div>
            <div class="fc-body">
                <div class="grid-3">
                    <div class="form-group"><label class="form-label">Service Type</label>
                        <select id="in-service" class="form-input">
                            <option value="Insect & Rodent">Insect & Rodent</option>
                            <option value="Termite Control">Termite Control</option>
                            <option value="Fumigation">Fumigation</option>
                            <option value="General Cleaning">General Cleaning</option>
                        </select>
                    </div>
                    <div class="form-group"><label class="form-label">Nilai Kontrak (DPP)</label><input type="text" id="in-nilai" class="form-input" onkeyup="formatInputCurrency(this)"></div>
                    <div class="form-group"><label class="form-label">Durasi (Bulan)</label><input type="number" id="in-duration" class="form-input" value="12" readonly style="background:#f5f5f5;"></div>
                </div>
                <div class="grid-2">
                    <div class="form-group"><label class="form-label">Start Date</label><input type="date" id="in-start-date" class="form-input" onchange="calcDuration()"></div>
                    <div class="form-group"><label class="form-label">End Date</label><input type="date" id="in-end-date" class="form-input" onchange="calcDuration()"></div>
                </div>
            </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:15px; padding-bottom:50px;">
            <button onclick="navigate('ar_monitor')" class="btn-cancel">Batal</button>
            <button onclick="submitNewContract()" class="btn-save-contract"><i class="ri-save-3-line"></i> SIMPAN KONTRAK BARU</button>
        </div>
    </div>`;
}

function parseContractNumber() {
    const full = document.getElementById('in-full-contract').value;
    const badge = document.getElementById('parse-status');
    const outClient = document.getElementById('in-client-id');
    const outUniq = document.getElementById('in-uniq-id');

    if (!full) {
        badge.className = 'parse-badge pending'; badge.innerText = 'Menunggu Input...';
        outClient.value = ''; outUniq.value = ''; return;
    }
    const parts = full.split('/');
    if (parts.length >= 2) {
        const clientId = parts[0].trim();
        const uniqId = parts[1].trim();
        outClient.value = clientId; outUniq.value = uniqId;
        badge.className = 'parse-badge success'; badge.innerText = 'Valid Format';
        
        const existingClient = clientsDB.find(c => c.id === clientId);
        if(existingClient) {
            document.getElementById('in-client-name').value = existingClient.name;
            fillClientForm(existingClient);
            badge.innerText = 'Client Ditemukan!';
        }
    } else {
        badge.className = 'parse-badge error'; badge.innerText = 'Format Salah';
        outClient.value = '???'; outUniq.value = '???';
    }
}

function handleClientSuggest(input) {
    const val = input.value.toLowerCase();
    const box = document.getElementById('client-suggestions');
    
    if (val.length < 2) { 
        box.classList.add('hidden'); 
        return; 
    }

    // [UPDATE] Cari berdasarkan NAMA atau ID
    const matches = clientsDB.filter(c => 
        c.name.toLowerCase().includes(val) || 
        String(c.id).toLowerCase().includes(val)
    );

    if (matches.length > 0) {
        box.innerHTML = matches.map(c => {
            // Logika Smart List (Versi contract_input.js)
            let contractsHtml = '';
            if (c.contracts && c.contracts.length > 0) {
                contractsHtml = `<div class="contract-mini-list" style="display:flex; gap:5px; margin-top:4px; flex-wrap:wrap;">`;
                c.contracts.forEach(ctr => {
                    // Gunakan checkCompletenessInput lokal atau checkContractCompleteness global jika tersedia
                    let isComplete = false;
                    if (typeof checkCompletenessInput === 'function') isComplete = checkCompletenessInput(ctr);
                    else if (typeof checkContractCompleteness === 'function') isComplete = checkContractCompleteness(ctr);

                    const badgeStyle = isComplete 
                        ? 'color:#1b5e20; background:#e8f5e9; border:1px solid #c8e6c9;' 
                        : 'color:#b71c1c; background:#ffebee; border:1px solid #ffcdd2;';
                    
                    const label = ctr.id_uniq || 'No-ID';
                    contractsHtml += `<span style="font-size:10px; padding:2px 6px; border-radius:4px; font-family:monospace; font-weight:700; ${badgeStyle}">${label}</span>`;
                });
                contractsHtml += `</div>`;
            } else {
                contractsHtml = `<div style="font-size:9px; color:#999; margin-top:2px;">- Belum ada kontrak -</div>`;
            }

            return `
            <div class="sugg-item" onclick="selectSuggestion('${c.id}')" style="padding:10px; border-bottom:1px solid #eee; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:#1f3045;">${c.name}</strong>
                    <small style="background:#f1f5f9; padding:2px 5px; border-radius:4px;">${c.id}</small>
                </div>
                <small style="color:#666;">${c.address || '-'}</small>
                ${contractsHtml}
            </div>
            `;
        }).join('');
        
        box.classList.remove('hidden');
    } else {
        box.innerHTML = `<div style="padding:10px; color:#999; font-size:12px;">Client baru (belum ada di database)</div>`;
        box.classList.remove('hidden');
    }
}

function selectSuggestion(id) {
    const client = clientsDB.find(c => c.id === id);
    if(client) {
        document.getElementById('in-client-name').value = client.name;
        fillClientForm(client);
        document.getElementById('client-suggestions').classList.add('hidden');
        const currId = document.getElementById('in-client-id').value;
        if(!currId) document.getElementById('in-client-id').value = client.id;
    }
}

function fillClientForm(client) {
    document.getElementById('in-client-address').value = client.address || '';
    document.getElementById('in-pic').value = client.pic || '';
    document.getElementById('in-phone').value = client.phone || '';
    document.getElementById('in-email').value = client.email || '';
    document.getElementById('in-payment').value = client.payment_method || 'VA Open Payment';
    document.getElementById('in-va').value = client.va_number || '';
}

function calcDuration() {
    const sDate = document.getElementById('in-start-date').value;
    const eDate = document.getElementById('in-end-date').value;
    if(sDate && eDate) {
        const d1 = new Date(sDate); const d2 = new Date(eDate);
        let months = (d2.getFullYear() - d1.getFullYear()) * 12;
        months -= d1.getMonth(); months += d2.getMonth();
        document.getElementById('in-duration').value = months <= 0 ? 0 : months + 1;
    }
}

function submitNewContract() {
    const contractNo = document.getElementById('in-full-contract').value;
    const clientId = document.getElementById('in-client-id').value;
    const uniqId = document.getElementById('in-uniq-id').value;
    const clientName = document.getElementById('in-client-name').value;
    const startDate = document.getElementById('in-start-date').value;
    const endDate = document.getElementById('in-end-date').value;
    const nilaiRaw = getRawValue('in-nilai');

    if(!contractNo || !clientId || !uniqId || !clientName || !startDate || !nilaiRaw) {
        alert("Harap lengkapi data wajib:\n- No Kontrak (harus valid)\n- Nama Client\n- Tanggal Mulai & Selesai\n- Nilai Kontrak");
        return;
    }

    const payload = {
        action: 'add_new_contract',
        client: {
            id: clientId, name: clientName, address: document.getElementById('in-client-address').value,
            pic: document.getElementById('in-pic').value, phone: document.getElementById('in-phone').value,
            email: document.getElementById('in-email').value, payment_method: document.getElementById('in-payment').value,
            va_number: document.getElementById('in-va').value
        },
        contract: {
            no_kontrak: contractNo, id_uniq: uniqId, start_date: startDate, end_date: endDate,
            duration: document.getElementById('in-duration').value, location: document.getElementById('in-work-location').value,
            nilai: nilaiRaw, service_type: document.getElementById('in-service').value
        }
    };

    if(!confirm("Pastikan data sudah benar.\nSimpan kontrak baru ini?")) return;
    const btn = document.querySelector('.btn-save-contract');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Menyimpan...'; btn.disabled = true;

    sendData(payload).then(() => { navigate('ar_monitor'); }).finally(() => { btn.innerHTML = originalText; btn.disabled = false; });
}