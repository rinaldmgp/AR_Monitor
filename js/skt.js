document.addEventListener('DOMContentLoaded', () => {
    // 1. Ambil Data
    const rawData = localStorage.getItem('skt_print_data');
    if (!rawData) {
        document.body.innerHTML = '<h2 style="text-align:center; margin-top:50px;">Tidak ada data untuk dicetak.<br>Silakan kembali ke Dashboard.</h2>';
        return;
    }
    const data = JSON.parse(rawData);
    renderSKT(data);
});

function renderSKT(data) {
    const client = data.client;
    const bills = data.bills;
    const totalAmount = data.total;
    const rp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });

    const today = new Date();
    // Format tanggal
    const dateStr = today.toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}); 
    
    const romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    const blnRomawi = romans[today.getMonth()];
    const thn = today.getFullYear();
    const noSurat = `00${Math.floor(Math.random()*9000)+1000}/FIN-AR/BTN/${blnRomawi}/${thn}`;

    let periodeStr = "-";
    if (bills.length > 0) {
        const first = bills[0].period; 
        const last = bills[bills.length-1].period;
        periodeStr = (first === last) ? first : `${first} - ${last}`;
    }

    const container = document.getElementById('paper-content');

    // --- 1. HEADER ---
    const headerHTML = `
        <div class="skt-header">
            <div class="header-left">
                <img src="images/ETOS LOGO BIRU.png" class="logo-main" alt="ETOS Logo">
            </div>
            <div class="header-right">
                <div class="company-name">PT. ETOS INDONUSA</div>
                <div>Jl. Daan Mogot 121, Jakarta Barat 11510</div>
                <div>Telp: (62-21) 560-6688, 563-ETOS</div>
                <div>Fax: (62-21) 566-2992, 560-5762</div>
                <div>www.etos-online.com | finance@etos.co.id</div>
            </div>
        </div>
        <div class="header-line"></div>
    `;

    // --- 2. FOOTER ---
    const footerHTML = `
        <div class="skt-footer">
            <div class="footer-left">
                <img src="images/MEMBEROF.jpg" class="img-memberof" alt="Member Of">
                <div class="footer-logos-group">
                    <img src="images/BULET KUNING.jpg" class="img-bulet-kuning" alt="Asosiasi">
                    <img src="images/NPMA.jpg" class="img-npma" alt="NPMA">
                </div>
            </div>
            <div class="footer-right">
                <img src="images/ISO.jpg" class="img-iso" alt="ISO 9001">
            </div>
        </div>
    `;

    // --- 3. BODY HALAMAN 1 ---
    const page1HTML = `
        <div class="page-content">
            <div class="letter-title">SURAT KONFIRMASI TAGIHAN</div>
            <div class="letter-no">${noSurat}</div>

            <div class="letter-meta">
                <table style="width:100%; font-size:10pt;">
                    <tr>
                        <td width="55%" style="vertical-align:top;">
                            <strong>Kepada Pelanggan Yth:</strong><br>
                            <span class="recipient-name">${client.name.toUpperCase()}</span><br>
                            FINANCE
                        </td>
                        <td width="45%" style="vertical-align:top; text-align:right;">
                            <table style="width:100%;">
                                <tr><td width="100">Tanggal Cetak</td><td>: ${dateStr}</td></tr>
                                <tr><td>Periode Kerja</td><td>: ${periodeStr}</td></tr>
                                <tr><td>Total Tagihan</td><td>: <strong>${rp.format(totalAmount)}</strong></td></tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="content-text">Dengan hormat,</div>

            <div class="content-text">
                Melalui surat ini, kami bermaksud menyampaikan informasi mengenai sejumlah tagihan dari <strong>PT. ETOS INDONUSA</strong> yang telah memasuki masa jatuh tempo.
            </div>

            <div class="content-text">
                Adapun rincian lengkap mengenai daftar faktur dan nominal tagihan tersebut dapat Bapak/Ibu lihat pada lampiran di Halaman 2.
            </div>

            <div class="content-text">
                Sehubungan dengan hal tersebut, kami memohon kesediaan pihak <strong>${client.name.toUpperCase()}</strong> untuk memberikan konfirmasi serta kepastian tanggal (komitmen) pelunasan tagihan.
            </div>

            <div class="content-text">
                Perlu kami informasikan bahwa mengacu pada kebijakan manajemen PT. ETOS INDONUSA, apabila pembayaran belum kami terima melewati batas waktu yang ditentukan, maka sistem ERP kami akan secara otomatis mengunci layanan (<em>service suspend</em>).
            </div>

            <div class="content-text">Sebagai implikasinya:</div>
            <div class="warning-list">
                1. Layanan treatment akan dihentikan sementara, dan kendala hama yang mungkin timbul selama masa penghentian layanan tersebut sepenuhnya berada di luar tanggung jawab kami.<br>
                2. Sistem ERP tidak dapat memproses penerbitan perpanjangan kontrak.
            </div>

            <div class="content-text">
                Mengingat kerja sama yang telah terjalin dengan baik selama ini, kami sangat mengharapkan konfirmasi jadwal pembayaran agar layanan dapat terus berjalan lancar.
            </div>

            <div class="content-text">
                Jika Bapak/Ibu telah melakukan pembayaran sebelum surat ini diterima, mohon kerjasamanya untuk mengirimkan bukti transfer melalui:
                <div style="margin-top:5px; margin-left: 15px;">
                    <li>Email: <span class="contact-info">finance@etos.co.id (U.p. Rinald)</span></li>
                    <li>WhatsApp: <span class="contact-info">+62 811-1913-6715</span></li>
                </div>
            </div>

            <div class="content-text" style="margin-top:15px;">
                Demikian surat konfirmasi tagihan ini kami sampaikan. Atas perhatian dan kerjasamanya, kami ucapkan terima kasih.
            </div>

            <div class="signature-section">
                <div>Hormat Kami,</div>
                <img src="images/ttd pa ari.jpg" class="sig-img" alt="TTD">
                <div class="sig-name">Ari Indra Wijaya</div>
                <div class="sig-title">Manager Finance Accounting & Tax</div>
            </div>
        </div>
    `;

    // --- 4. BODY HALAMAN 2 (TABEL) ---
    let tableRows = '';
    bills.forEach(b => {
        tableRows += `
            <tr>
                <td class="text-center">${b.period}</td>
                <td class="text-center">${b.faktur || '-'}</td>
                <td>${b.invoice || '-'}</td>
                <td class="text-right">${rp.format(b.amount)}</td>
            </tr>
        `;
    });

    const page2HTML = `
        <div class="page-break"></div>
        
        <div class="page-content">
            <div class="table-title">Data Outstanding :</div>
            <p style="font-size:10pt; margin-bottom:5px;">The following table:</p>
            
            <table class="data-table">
                <thead>
                    <tr>
                        <th width="20%">Periode Kerja</th>
                        <th width="25%">Faktur Pajak</th>
                        <th width="30%">Nomer Tagihan</th>
                        <th width="25%">Harga</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                    <tr>
                        <td colspan="3" class="text-right text-bold bg-grey">TOTAL</td>
                        <td class="text-right text-bold bg-grey">${rp.format(totalAmount)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = headerHTML + footerHTML + page1HTML + page2HTML;
}

function triggerPrint() {
    window.print();
}