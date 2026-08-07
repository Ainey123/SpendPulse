const installBtn = document.getElementById('installBtn');
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Convert any Base64 image (JPG, PNG, WebP, GIF, etc.) to PNG Uint8Array via Canvas
async function imageBase64ToPngBytes(base64Str) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas toBlob failed'));
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => resolve(new Uint8Array(reader.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(blob);
            }, 'image/png');
        };
        img.onerror = (err) => reject(err);
        img.src = base64Str;
    });
}

// Render PDF Page 1 to canvas and return PNG Uint8Array
async function pdfBase64ToPngBytes(pdfBase64Str) {
    try {
        const pdfDoc = await pdfjsLib.getDocument(pdfBase64Str).promise;
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Canvas toBlob failed for PDF'));
                    return;
                }
                const reader = new FileReader();
                reader.onloadend = () => resolve(new Uint8Array(reader.result));
                reader.onerror = reject;
                reader.readAsArrayBuffer(blob);
            }, 'image/png');
        });
    } catch (err) {
        console.warn('Could not render PDF page to image:', err);
        return null;
    }
}

// Generate a complete PDF with extracted bill data + embedded picture
async function generateReceiptPdf(data, imageBase64, pdfBase64) {
    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        let imgBytes = null;
        if (imageBase64) {
            try {
                imgBytes = await imageBase64ToPngBytes(imageBase64);
            } catch (e) {
                console.warn('Canvas conversion failed, fallback to raw b64:', e);
                const rawB64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
                imgBytes = Uint8Array.from(atob(rawB64), c => c.charCodeAt(0));
            }
        } else if (pdfBase64) {
            imgBytes = await pdfBase64ToPngBytes(pdfBase64);
        }

        let embeddedImg = null;
        if (imgBytes) {
            try {
                embeddedImg = await pdfDoc.embedPng(imgBytes);
            } catch (err) {
                console.warn('embedPng failed, trying embedJpg:', err);
                try {
                    embeddedImg = await pdfDoc.embedJpg(imgBytes);
                } catch (e) {
                    console.warn('Both embedPng and embedJpg failed:', e);
                }
            }
        }

        const pageWidth = 595.28; // A4 width
        const pageHeight = 841.89; // A4 height
        const page = pdfDoc.addPage([pageWidth, pageHeight]);

        // 1. Top Header Banner
        page.drawRectangle({
            x: 0,
            y: pageHeight - 70,
            width: pageWidth,
            height: 70,
            color: rgb(0.31, 0.27, 0.9), // Indigo #4f46e5
        });

        page.drawText('SpendPulse - Bill Record & Receipt', {
            x: 30,
            y: pageHeight - 42,
            size: 20,
            font: fontBold,
            color: rgb(1, 1, 1),
        });

        page.drawText('Verified Transaction Summary & Visual Proof', {
            x: 30,
            y: pageHeight - 58,
            size: 10,
            font: font,
            color: rgb(0.85, 0.85, 1),
        });

        // 2. Data Card Box
        const cardX = 30;
        const cardY = pageHeight - 270;
        const cardWidth = pageWidth - 60;
        const cardHeight = 180;

        page.drawRectangle({
            x: cardX,
            y: cardY,
            width: cardWidth,
            height: cardHeight,
            color: rgb(0.97, 0.98, 1),
            borderColor: rgb(0.8, 0.85, 0.95),
            borderWidth: 1.5,
        });

        // Amount Header
        const amtStr = data.amount ? `${data.amount} ${data.currency || 'PKR'}` : 'N/A';
        page.drawText('TOTAL AMOUNT:', { x: cardX + 20, y: cardY + cardHeight - 28, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.4) });
        page.drawText(amtStr, { x: cardX + 130, y: cardY + cardHeight - 32, size: 20, font: fontBold, color: rgb(0.02, 0.5, 0.34) });

        // Record Grid
        const records = [
            { label: 'From (Sender):', val: data.sender_name || 'N/A' },
            { label: 'To (Receiver):', val: data.receiver_name || 'N/A' },
            { label: 'Date:', val: data.date || 'N/A' },
            { label: 'Time:', val: data.time || 'N/A' },
            { label: 'Reference / TRX:', val: data.reference_number || 'N/A' },
            { label: 'Purpose:', val: data.purpose || 'Payment' },
        ];

        let rY = cardY + cardHeight - 65;
        for (let i = 0; i < records.length; i += 2) {
            const r1 = records[i];
            const r2 = records[i + 1];

            page.drawText(r1.label, { x: cardX + 20, y: rY, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
            page.drawText(String(r1.val), { x: cardX + 130, y: rY, size: 10, font: font, color: rgb(0.1, 0.1, 0.1) });

            if (r2) {
                page.drawText(r2.label, { x: cardX + 280, y: rY, size: 10, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
                page.drawText(String(r2.val), { x: cardX + 390, y: rY, size: 10, font: font, color: rgb(0.1, 0.1, 0.1) });
            }
            rY -= 30;
        }

        // 3. Image Section Title
        page.drawText('ATTACHED BILL / RECEIPT PICTURE:', {
            x: 30,
            y: cardY - 25,
            size: 11,
            font: fontBold,
            color: rgb(0.2, 0.2, 0.2),
        });

        // 4. Draw Embedded Image
        if (embeddedImg) {
            const maxImgW = pageWidth - 60; // 535 pt
            const maxImgH = cardY - 70;     // Height remaining

            const scaleW = maxImgW / embeddedImg.width;
            const scaleH = maxImgH / embeddedImg.height;
            const scale = Math.min(scaleW, scaleH, 1.0);

            const imgW = embeddedImg.width * scale;
            const imgH = embeddedImg.height * scale;

            const imgX = (pageWidth - imgW) / 2;
            const imgY = cardY - 35 - imgH;

            // Border box
            page.drawRectangle({
                x: imgX - 3,
                y: imgY - 3,
                width: imgW + 6,
                height: imgH + 6,
                color: rgb(0.95, 0.95, 0.95),
                borderColor: rgb(0.8, 0.8, 0.8),
                borderWidth: 1,
            });

            page.drawImage(embeddedImg, {
                x: imgX,
                y: imgY,
                width: imgW,
                height: imgH,
            });
        } else {
            page.drawText('(No bill preview image available)', {
                x: 30,
                y: cardY - 50,
                size: 10,
                font: font,
                color: rgb(0.5, 0.5, 0.5),
            });
        }

        // Footer
        page.drawText('SpendPulse Scanner • Automatic Bill Extraction & Archive', {
            x: 30,
            y: 15,
            size: 8,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
        });

        const pdfBytes = await pdfDoc.save();
        return new Blob([pdfBytes], { type: 'application/pdf' });
    } catch (err) {
        console.error('PDF generation failed:', err);
        return null;
    }
}

// Download extracted bill record directly as CSV file
function downloadCsv(data) {
    const headers = ["Reference Number", "Date", "Time", "Amount", "Currency", "From", "To", "Purpose", "Transaction Type"];
    const row = [
        `"${data.reference_number || ''}"`,
        `"${data.date || ''}"`,
        `"${data.time || ''}"`,
        `"${data.amount || ''}"`,
        `"${data.currency || 'PKR'}"`,
        `"${data.sender_name || ''}"`,
        `"${data.receiver_name || ''}"`,
        `"${data.purpose || 'Payment'}"`,
        `"${data.transaction_type || 'Payment'}"`
    ];

    const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + row.join(",");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const filename = `Bill_${data.reference_number || 'Record'}_${data.date || 'Date'}.csv`;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
        } else {
            alert("📱 To install this app on your phone or computer:\n\n1. Open your browser menu (3 dots / Share button)\n2. Tap 'Add to Home Screen' or 'Install App'!");
        }
    });
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const pdfDropzone = document.getElementById('pdfDropzone');
const pdfInput = document.getElementById('pdfInput');
const preview = document.getElementById('preview');
const scanBtn = document.getElementById('scanBtn');
const loading = document.getElementById('loading');
const loadingStatus = document.getElementById('loadingStatus');
const message = document.getElementById('message');

let currentBase64 = null;
let currentFileType = 'image';
let currentPdfBase64 = null;

dropzone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', handleFile);
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#4f46e5'; });
dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = '#9ca3af');
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#9ca3af';
    if (e.dataTransfer.files.length) handleFile({ target: { files: e.dataTransfer.files } });
});

pdfDropzone.addEventListener('click', () => pdfInput.click());
pdfInput.addEventListener('change', handlePdfFile);
pdfDropzone.addEventListener('dragover', (e) => { e.preventDefault(); pdfDropzone.style.borderColor = '#4f46e5'; });
pdfDropzone.addEventListener('dragleave', () => pdfDropzone.style.borderColor = '#059669');
pdfDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    pdfDropzone.style.borderColor = '#059669';
    if (e.dataTransfer.files.length) handlePdfFile({ target: { files: e.dataTransfer.files } });
});

function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        currentBase64 = event.target.result;
        currentFileType = 'image';
        preview.src = currentBase64;
        preview.classList.remove('hidden');
        scanBtn.classList.remove('hidden');
        scanBtn.textContent = 'Upload & Save to Sheet';
        dropzone.classList.add('hidden');
        message.classList.add('hidden');
    };
    reader.readAsDataURL(file);
}

function handlePdfFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
        message.textContent = 'PDF too large (max 50MB).';
        message.className = 'error';
        message.classList.remove('hidden');
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
        currentPdfBase64 = event.target.result;
        currentFileType = 'pdf';
        preview.classList.add('hidden');
        scanBtn.classList.remove('hidden');
        scanBtn.textContent = 'Upload PDF & Save to Sheet';
        pdfDropzone.classList.add('hidden');
        message.classList.add('hidden');
    };
    reader.readAsDataURL(file);
}

function parseReceiptText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let amount = "";
    let currency = "PKR";
    let sender_name = "";
    let receiver_name = "";
    let reference_number = "";
    let date = "";
    let time = "";

    // 1. Amount Extraction (supports 30,000, 30000, 30k -> 30000, PKR 30,000, Rs 30000)
    const amtMatch = text.match(/(?:PKR|RS|USD|EUR|\$)\s*([\d,]+(?:\.\d{2})?)/i) || 
                     text.match(/\b([\d,]{3,}(?:\.\d{2})?)\b/);
    if (amtMatch) {
        amount = amtMatch[1].replace(/,/g, '');
    }

    // 2. Date Extraction (e.g., 22-Jul-2026, 30-Jul-2025, 22/07/2026, 2026-07-22, 22 Jul 2026)
    const dateMatch = text.match(/\b(\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2})[-/\s]\d{2,4})\b/i) ||
                      text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i);
    if (dateMatch) {
        date = dateMatch[1];
    } else {
        date = new Date().toISOString().split('T')[0];
    }

    // 3. Time Extraction (e.g., 05:26:35 PM, 05:26 PM, 17:25)
    const timeMatch = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\b/);
    if (timeMatch) {
        time = timeMatch[1];
    } else {
        time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // 4. Reference / Transaction ID
    const refMatch = text.match(/(?:Ref|Reference|Txn|Transaction ID|TRX|ID)[:\s]*([A-Z0-9]{5,25})/i) ||
                      text.match(/\b(\d{10,20})\b/);
    if (refMatch) {
        reference_number = refMatch[1];
    }

    // 5. Sender Name (From) & Receiver Name (To)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Sender "From"
        if (/^(From|Sender|Remitter|Paid By|Debited From)[:\s]*/i.test(line)) {
            let val = line.replace(/^(From|Sender|Remitter|Paid By|Debited From)[:\s]*/i, '').trim();
            if (!val && i + 1 < lines.length) val = lines[i+1];
            if (val && !/^\d+$/.test(val) && !/Account|Bank|Balance/i.test(val)) sender_name = val;
        }

        // Receiver "To"
        if (/^(To|Receiver|Beneficiary|Paid To|Credited To|Title)[:\s]*/i.test(line)) {
            let val = line.replace(/^(To|Receiver|Beneficiary|Paid To|Credited To|Title)[:\s]*/i, '').trim();
            if (!val && i + 1 < lines.length) val = lines[i+1];
            if (val && !/^\d+$/.test(val) && !/Account|Bank|Balance/i.test(val)) receiver_name = val;
        }
    }

    // Fallback name search if keywords were on separate lines
    if (!receiver_name || !sender_name) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toUpperCase() === "FROM" && i + 1 < lines.length) {
                if (!sender_name) sender_name = lines[i+1];
            }
            if (lines[i].toUpperCase() === "TO" && i + 1 < lines.length) {
                if (!receiver_name) receiver_name = lines[i+1];
            }
        }
    }

    return {
        amount,
        currency,
        sender_name: sender_name || "Sender",
        receiver_name: receiver_name || "Receiver",
        reference_number,
        date,
        time,
        raw_text: text
    };
}

scanBtn.addEventListener('click', async () => {
    scanBtn.classList.add('hidden');
    loading.classList.remove('hidden');
    message.classList.add('hidden');

    let extractedData = null;
    let endpoint = '/api/scan';
    let bodyPayload = {};

    if (currentFileType === 'pdf' && currentPdfBase64) {
        loadingStatus.textContent = "Extracting text from PDF...";
        // Use pdf.js to extract text client-side (no PDF bytes sent to server)
        try {
            const pdfDoc = await pdfjsLib.getDocument(currentPdfBase64).promise;
            let fullText = "";
            for (let i = 1; i <= Math.min(pdfDoc.numPages, 5); i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map(item => item.str).join(" ") + "\n";
            }
            extractedData = parseReceiptText(fullText);
            bodyPayload = { extracted_data: extractedData };
        } catch (err) {
            console.warn("PDF text extraction failed:", err);
            throw new Error("Could not read PDF text. Please try a different PDF.");
        }
    } else if (currentBase64) {
        loadingStatus.textContent = "Scanning text from image...";
        endpoint = '/api/scan';
        try {
            if (window.Tesseract) {
                const worker = await Tesseract.createWorker('eng');
                const ret = await worker.recognize(currentBase64);
                await worker.terminate();
                extractedData = parseReceiptText(ret.data.text);
            }
        } catch (err) {
            console.warn("Client OCR failed, fallback to server:", err);
        }
        bodyPayload = { image_base64: currentBase64, extracted_data: extractedData };
    } else {
        loading.classList.add('hidden');
        scanBtn.classList.remove('hidden');
        message.textContent = 'No file selected.';
        message.className = 'error';
        message.classList.remove('hidden');
        return;
    }

    loadingStatus.textContent = "Saving to Google Sheet...";

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });
        const data = await res.json();

        loading.classList.add('hidden');

        if (res.ok) {
            // Check if server detected duplicate payment
            if (data.is_duplicate) {
                loading.classList.add('hidden');
                
                const modal = document.getElementById('duplicateModal');
                const detailsBox = document.getElementById('duplicateDetails');
                const continueBtn = document.getElementById('continueSaveBtn');
                const cancelBtn = document.getElementById('cancelSaveBtn');

                const dup = data.duplicate_info || {};
                detailsBox.innerHTML = `
                    <strong>Previous Payment Record Found:</strong><br/>
                    <b>Amount:</b> ${dup.amount || 'N/A'}<br/>
                    <b>Recipient:</b> ${dup.receiver_name || 'N/A'}<br/>
                    <b>Date:</b> ${dup.date || ''} ${dup.time || ''}<br/>
                    ${dup.reference_number ? `<b>Ref ID:</b> ${dup.reference_number}` : ''}
                `;

                modal.classList.remove('hidden');

                continueBtn.onclick = async () => {
                    modal.classList.add('hidden');
                    loading.classList.remove('hidden');
                    loadingStatus.textContent = "Saving payment to Google Sheet...";
                    
                    try {
                        const forcePayload = { ...bodyPayload, force_save: true };
                        const forceRes = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(forcePayload)
                        });
                        const forceData = await forceRes.json();
                        if (forceRes.ok) {
                            await renderSuccessResult(forceData);
                        } else {
                            throw new Error(forceData.error || 'Failed to save transaction');
                        }
                    } catch (e) {
                        loading.classList.add('hidden');
                        scanBtn.classList.remove('hidden');
                        message.textContent = e.message;
                        message.className = 'error';
                        message.classList.remove('hidden');
                    }
                };

                cancelBtn.onclick = () => {
                    modal.classList.add('hidden');
                    scanBtn.classList.remove('hidden');
                    message.textContent = '❌ Payment recording cancelled. Duplicate payment was not saved.';
                    message.className = 'error';
                    message.classList.remove('hidden');
                };

                return;
            }

            await renderSuccessResult(data);
        } else {
            throw new Error(data.error || 'Failed to scan and save');
        }
    } catch (err) {
        loading.classList.add('hidden');
        scanBtn.classList.remove('hidden');
        message.textContent = err.message;
        message.className = 'error';
        message.classList.remove('hidden');
    }
});

async function renderSuccessResult(data) {
    loading.classList.add('hidden');
    const amt = data.amount ? `${data.amount} ${data.currency || 'PKR'}` : 'Saved';

    loadingStatus.textContent = "Generating PDF document...";
    const pdfBlob = await generateReceiptPdf(data, currentBase64, currentPdfBase64);
    let pdfUrl = null;
    if (pdfBlob) {
        pdfUrl = URL.createObjectURL(pdfBlob);
    } else if (currentPdfBase64) {
        pdfUrl = currentPdfBase64;
    }

    message.innerHTML = `
        <div style="margin-bottom: 12px; text-align: left; background: #ecfdf5; padding: 14px; border-radius: 8px; border: 1px solid #6ee7b7;">
            <strong style="color: #047857; font-size: 16px;">✅ Extracted & Saved to Spreadsheet!</strong><br/>
            <div style="font-size: 24px; color: #065f46; font-weight: bold; margin: 6px 0;">${amt}</div>
            <div style="font-size: 13px; color: #374151; line-height: 1.6;">
                ${data.sender_name ? `<b>From:</b> ${data.sender_name}<br/>` : ''}
                ${data.receiver_name ? `<b>To:</b> ${data.receiver_name}<br/>` : ''}
                ${data.date ? `<b>Date:</b> ${data.date} ${data.time || ''}<br/>` : ''}
                ${data.reference_number ? `<b>Ref ID:</b> ${data.reference_number}` : ''}
            </div>
        </div>
        <div class="button-group">
            ${pdfUrl ? `<a href="${pdfUrl}" target="_blank" class="action-btn pdf-btn">📄 Open PDF (Record & Picture)</a>` : ''}
            ${data.sheet_url ? `<a href="${data.sheet_url}" target="_blank" class="action-btn sheet-btn">📊 Open Google Sheet / Excel</a>` : ''}
            <button id="csvDownloadBtn" class="action-btn csv-btn">📥 Download CSV File</button>
        </div>
    `;
    message.className = 'success';
    message.classList.remove('hidden');

    const csvBtn = document.getElementById('csvDownloadBtn');
    if (csvBtn) {
        csvBtn.addEventListener('click', () => downloadCsv(data));
    }

    setTimeout(() => {
        currentBase64 = null;
        currentPdfBase64 = null;
        currentFileType = 'image';
        preview.classList.add('hidden');
        dropzone.classList.remove('hidden');
        pdfDropzone.classList.remove('hidden');
        fileInput.value = "";
        pdfInput.value = "";
    }, 60000);
}

