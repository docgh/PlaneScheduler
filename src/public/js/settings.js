/* PlaneScheduler — Settings page */
document.addEventListener('DOMContentLoaded', () => {
  let aircraft = [];
  let subscriptions = new Set();

  async function api(url, opts = {}) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('Not authenticated');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.errors?.map(e => e.msg).join(', ') || 'Request failed');
    return data;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str ?? ''));
    return div.innerHTML;
  }

  // ---------- Notification Subscriptions ----------
  async function loadSubscriptions() {
    try {
      aircraft = await api('/api/aircraft');
      const subIds = await api('/api/subscriptions');
      subscriptions = new Set(subIds);
      renderSubscriptions();
    } catch (err) {
      console.error('Failed to load subscriptions:', err);
    }
  }

  function renderSubscriptions() {
    const container = document.getElementById('subscriptionList');
    if (!container || aircraft.length === 0) {
      if (container) container.innerHTML = '<span class="text-muted">No aircraft available</span>';
      return;
    }
    container.innerHTML = aircraft.map(ac => {
      const checked = subscriptions.has(ac.id) ? 'checked' : '';
      return `
        <div class="form-check form-switch mb-2">
          <input class="form-check-input sub-toggle" type="checkbox" id="sub-${ac.id}" data-ac-id="${ac.id}" ${checked}>
          <label class="form-check-label" for="sub-${ac.id}">
            <strong>${escapeHtml(ac.tail_number)}</strong>
            <small class="text-muted">${escapeHtml(ac.make)} ${escapeHtml(ac.model)}</small>
          </label>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.sub-toggle').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const acId = parseInt(e.target.dataset.acId, 10);
        e.target.disabled = true;
        try {
          if (e.target.checked) {
            await api(`/api/subscriptions/${acId}`, { method: 'POST' });
            subscriptions.add(acId);
          } else {
            await api(`/api/subscriptions/${acId}`, { method: 'DELETE' });
            subscriptions.delete(acId);
          }
        } catch (err) {
          e.target.checked = !e.target.checked;
          alert(err.message);
        } finally {
          e.target.disabled = false;
        }
      });
    });
  }

  // ---------- Change Password ----------
  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errDiv = document.getElementById('pwError');
    const successDiv = document.getElementById('pwSuccess');
    const btn = document.getElementById('changePwBtn');
    const spinner = document.getElementById('pwSpinner');

    errDiv.classList.add('d-none');
    successDiv.classList.add('d-none');

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmNewPassword) {
      errDiv.textContent = 'New passwords do not match';
      errDiv.classList.remove('d-none');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('d-none');
    try {
      const result = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      successDiv.textContent = result.message;
      successDiv.classList.remove('d-none');
      document.getElementById('passwordForm').reset();
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // ---------- Init ----------
  loadSubscriptions();
});
