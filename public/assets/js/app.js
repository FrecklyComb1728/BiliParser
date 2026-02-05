
function downloadCover(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cover.jpg';
    a.target = '_blank';
    a.click();
}

function copyText(text, successMsg = '已复制') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(successMsg, 'success');
        }).catch(() => {
            fallbackCopy(text, successMsg);
        });
    } else {
        fallbackCopy(text, successMsg);
    }
}

function fallbackCopy(text, successMsg) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast(successMsg, 'success');
    } catch (err) {
        showToast('复制失败', 'danger');
    }
    document.body.removeChild(textarea);
}

function copy(inputId, successMsg = '已复制') {
    const el = document.getElementById(inputId);
    if (!el) {
        showToast('复制失败', 'danger');
        return;
    }
    const value = el.value || el.textContent || '';
    if (!value) {
        showToast('复制失败', 'danger');
        return;
    }
    copyText(value, successMsg);
}

function getLiveRoomId(text) {
    if (!text) return null;
    const trimmed = text.trim();
    const urlMatch = trimmed.match(/live\.bilibili\.com\/(\d+)/i);
    if (urlMatch) return urlMatch[1];
    const numericMatch = trimmed.match(/^(\d{3,})$/);
    if (numericMatch) return numericMatch[1];
    return null;
}

function setLoaderVisible(visible) {
    const loader = document.getElementById('loader');
    if (!loader) return;
    if (visible) {
        loader.style.display = 'flex';
        loader.style.opacity = '1';
    } else {
        loader.style.display = 'none';
        loader.style.opacity = '0';
    }
}

function buildLiveHtml(data) {
    const pic = (data.pic || '').replace('http:', 'https:');
    const format = data.format || 'LIVE';
    return `
        <div class="fade-in">
            <div class="card border-0 shadow-sm overflow-hidden rounded-4 bg-white">
                <div class="row g-0">
                    <div class="col-md-5 position-relative group bg-slate-100" style="min-height: 200px;">
                        <img src="${pic}" class="w-100 h-100 object-fit-cover transition-transform duration-500" style="object-position: center;" referrerpolicy="no-referrer">
                        <div class="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-black bg-opacity-10 opacity-0 hover:opacity-100 transition-opacity">
                            <button onclick="downloadCover('${pic}')" class="btn btn-sm btn-light fw-bold shadow-sm d-flex align-items-center gap-1">
                                <i class="ri-download-line"></i> 下载封面
                            </button>
                        </div>
                    </div>
                    <div class="col-md-7">
                        <div class="card-body p-4 d-flex flex-column h-100 justify-content-between gap-3">
                            <div>
                                <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                                    <h5 class="card-title fw-bold text-slate-800 mb-0 text-truncate-2">${data.title || ''}</h5>
                                </div>
                                <div>
                                    <span class="badge bg-danger-subtle text-danger font-monospace">LIVE</span>
                                    <span class="badge bg-slate-100 text-slate-600 font-monospace ms-2">${format}</span>
                                </div>
                            </div>

                            <div class="border-top border-slate-100 pt-3">
                                <div class="mb-3">
                                    <label class="form-label text-uppercase text-slate-400 fw-bold" style="font-size: 0.75rem; letter-spacing: 0.05em;">直链地址</label>
                                    <div class="input-group">
                                        <input type="text" class="form-control bg-slate-50 border-slate-200 text-slate-600 font-monospace fs-7" value="${data.downloadUrl || ''}" readonly id="res-link">
                                        <button class="btn btn-white border border-slate-200 text-slate-500 hover:text-sky-600 hover:bg-slate-50" type="button" onclick="copy('res-link')">
                                            <i class="ri-file-copy-line"></i>
                                        </button>
                                    </div>
                                </div>

                                <div class="d-grid gap-2 d-sm-flex">
                                    <a href="${data.downloadUrl || '#'}" target="_blank" class="btn btn-primary bg-sky-50 border-0 text-sky-600 fw-bold flex-fill d-flex align-items-center justify-content-center gap-2 py-2 hover:bg-sky-100">
                                        <i class="ri-play-circle-fill fs-5"></i>
                                        预览直播
                                    </a>
                                    <button type="button" class="btn btn-white border border-slate-200 text-slate-600 fw-bold flex-fill d-flex align-items-center justify-content-center gap-2 py-2 hover:bg-slate-50 hover:text-sky-600" onclick="copy('res-link', '直链已复制')">
                                        <i class="ri-download-cloud-line fs-5"></i>
                                        复制直链
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const bgClass = type === 'success' ? 'bg-success' : (type === 'danger' ? 'bg-danger' : 'bg-primary');
    
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white ${bgClass} border-0 show`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close" onclick="this.parentElement.parentElement.remove()"></button>
        </div>
    `;
    
    toastContainer.appendChild(toastEl);
    
    setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input');
    const clearBtn = document.getElementById('clearBtn');
    const form = document.querySelector('form[hx-get]');
    
    if (input && clearBtn) {
        input.addEventListener('input', () => {
            clearBtn.classList.toggle('d-none', !input.value);
        });
        
        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.classList.add('d-none');
            document.getElementById('result-container').innerHTML = '';
            input.focus();
        });
    }

    if (form && input) {
        form.addEventListener('submit', async (e) => {
            const roomId = getLiveRoomId(input.value);
            if (!roomId) return;
            e.preventDefault();
            e.stopPropagation();

            const resultContainer = document.getElementById('result-container');
            if (resultContainer) resultContainer.innerHTML = '';
            setLoaderVisible(true);
            try {
                const res = await fetch(`/api/live?room=${encodeURIComponent(roomId)}`);
                const data = await res.json();
                if (data.status === 'success') {
                    if (resultContainer) {
                        resultContainer.innerHTML = buildLiveHtml(data);
                    }
                    if (data.nodeType === 'OV') {
                        showToast('OV 节点可能无法播放，请重试', 'danger');
                    }
                } else {
                    showToast(data.message || '解析失败', 'danger');
                }
            } catch {
                showToast('请求失败', 'danger');
            } finally {
                setLoaderVisible(false);
            }
        });
    }
});
