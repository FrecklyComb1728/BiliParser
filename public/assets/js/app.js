
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
});
