/* PlaneScheduler — Admin page client-side logic */
document.addEventListener('DOMContentLoaded', () => {
  let aircraft = [];
  let currentUserId = null;
  let currentUserPrivileges = null;

  // ---------- helpers ----------
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
    div.textContent = str;
    return div.innerHTML;
  }

  function capitalizeFirst(str) {
    if (str == null) return '';
    const s = String(str);
    if (s.length === 0) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- Aircraft ----------
  async function loadAircraft() {
    aircraft = await api('/api/aircraft');
    // Populate usage aircraft dropdown
    const sel = document.getElementById('usageAircraft');
    if (sel) {
      sel.innerHTML = '<option value="">All Aircraft</option>';
      aircraft.forEach(ac => {
        const opt = document.createElement('option');
        opt.value = ac.id;
        opt.textContent = `${ac.tail_number} — ${ac.make} ${ac.model}`;
        sel.appendChild(opt);
      });
    }
  }

  // ---------- User Management (admin) ----------
  async function loadAllUsers() {
    try {
      const [pendingUsers, allUsers] = await Promise.all([
        api('/api/users/pending'),
        api('/api/users'),
      ]);

      // Pending users
      const pendingList = document.getElementById('pendingUsersList');
      const pendingCount = document.getElementById('pendingCount');
      pendingCount.textContent = pendingUsers.length;

      if (pendingUsers.length === 0) {
        pendingList.innerHTML = '<p class="text-muted">No pending users</p>';
      } else {
        pendingList.innerHTML = pendingUsers.map(u => `
          <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
            <div>
              <strong>${escapeHtml(capitalizeFirst(u.username))}</strong>
              <span class="text-muted ms-2">${escapeHtml(u.email)}</span>
              <small class="text-muted ms-2">${new Date(u.created_at).toLocaleDateString()}</small>
            </div>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success" data-action="approve" data-id="${u.id}" title="Approve as User">
                <i class="bi bi-check-lg"></i> Approve
              </button>
              <button class="btn btn-sm btn-outline-danger" data-action="reject" data-id="${u.id}" title="Reject">
                <i class="bi bi-x-lg"></i>
              </button>
            </div>
          </div>
        `).join('');
      }

      // All users table
      const tbody = document.getElementById('allUsersBody');
      tbody.innerHTML = allUsers.map(u => {
        const isSelf = u.id === currentUserId;
        return `
          <tr>
            <td>${escapeHtml(capitalizeFirst(u.username))}</td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="badge bg-${u.privileges === 'admin' ? 'danger' : u.privileges === 'maintainer' ? 'warning text-dark' : u.privileges === 'pending' ? 'secondary' : 'primary'}">${u.privileges}</span></td>
            <td>
              <div class="d-flex gap-1">
                <button class="btn btn-sm btn-outline-primary" data-action="edit-user" data-id="${u.id}" title="Edit">
                  <i class="bi bi-pencil"></i>
                </button>
                ${isSelf ? '' :
                  `<button class="btn btn-sm btn-outline-danger" data-action="delete-user" data-id="${u.id}" title="Delete">
                    <i class="bi bi-trash"></i>
                  </button>`}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  // Wire up Add User button
  const addUserBtn = document.getElementById('addUserBtn');
  if (addUserBtn) {
    addUserBtn.addEventListener('click', () => {
      document.getElementById('userFormTitle').innerHTML = '<i class="bi bi-person-plus"></i> Add User';
      document.getElementById('userForm').reset();
      document.getElementById('ufId').value = '';
      document.getElementById('ufPassword').required = true;
      document.getElementById('ufPasswordHint').textContent = '';
      document.getElementById('ufError').classList.add('d-none');
      new bootstrap.Modal(document.getElementById('userFormModal')).show();
    });
  }

  async function editUser(id) {
    try {
      const users = await api('/api/users');
      const u = users.find(x => x.id === id);
      if (!u) return alert('User not found');

      document.getElementById('userFormTitle').innerHTML = '<i class="bi bi-pencil"></i> Edit User';
      document.getElementById('ufId').value = u.id;
      document.getElementById('ufUsername').value = u.username;
      document.getElementById('ufEmail').value = u.email;
      document.getElementById('ufPassword').value = '';
      document.getElementById('ufPassword').required = false;
      document.getElementById('ufPasswordHint').textContent = '(leave blank to keep current)';
      document.getElementById('ufPrivileges').value = u.privileges;
      document.getElementById('ufError').classList.add('d-none');
      new bootstrap.Modal(document.getElementById('userFormModal')).show();
    } catch (err) {
      alert(err.message);
    }
  };

  // Submit user add/edit form
  const submitUserFormBtn = document.getElementById('submitUserForm');
  if (submitUserFormBtn) {
    submitUserFormBtn.addEventListener('click', async () => {
      const btn = submitUserFormBtn;
      const spinner = document.getElementById('ufSpinner');
      const errDiv = document.getElementById('ufError');
      errDiv.classList.add('d-none');

      const id = document.getElementById('ufId').value;
      const payload = {
        username: document.getElementById('ufUsername').value.trim(),
        email: document.getElementById('ufEmail').value.trim(),
        privileges: document.getElementById('ufPrivileges').value,
      };
      const password = document.getElementById('ufPassword').value;
      if (password) payload.password = password;

      if (!payload.username || !payload.email) {
        errDiv.textContent = 'Username and email are required';
        errDiv.classList.remove('d-none');
        return;
      }
      if (!id && !password) {
        errDiv.textContent = 'Password is required for new users';
        errDiv.classList.remove('d-none');
        return;
      }

      btn.disabled = true;
      spinner.classList.remove('d-none');
      try {
        if (id) {
          await api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
        }
        bootstrap.Modal.getInstance(document.getElementById('userFormModal')).hide();
        await loadAllUsers();
      } catch (err) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
      }
    });
  }

  // ---------- Event delegation for dynamically created buttons ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);

    switch (action) {
      case 'approve': return approveUser(id, 'user');
      case 'reject': return rejectUser(id);
      case 'edit-user': return editUser(id);
      case 'delete-user': return deleteUser(id);
      case 'edit-aircraft': return editAircraft(id);
      case 'delete-aircraft': return deleteAircraft(id);
    }
  });

  async function approveUser(id, privileges) {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ privileges }) });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  async function rejectUser(id) {
    if (!confirm('Reject and delete this user?')) return;
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  async function deleteUser(id) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  // ---------- Aircraft Management (admin) ----------
  async function loadAircraftManagement() {
    try {
      const acList = await api('/api/aircraft');
      const tbody = document.getElementById('aircraftMgmtBody');
      tbody.innerHTML = acList.map(ac => `
        <tr>
          <td><strong>${escapeHtml(ac.tail_number)}</strong></td>
          <td>${escapeHtml(ac.make)}</td>
          <td>${escapeHtml(ac.model)}</td>
          <td>${ac.year || '—'}</td>
          <td>${Number(ac.last_hobbs).toFixed(1)}</td>
          <td>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-primary" data-action="edit-aircraft" data-id="${ac.id}" title="Edit">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" data-action="delete-aircraft" data-id="${ac.id}" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load aircraft:', err);
    }
  }

  // Wire up Add Aircraft button
  const addAircraftBtn = document.getElementById('addAircraftBtn');
  if (addAircraftBtn) {
    addAircraftBtn.addEventListener('click', () => {
      document.getElementById('acFormTitle').innerHTML = '<i class="bi bi-airplane"></i> Add Aircraft';
      document.getElementById('aircraftForm').reset();
      document.getElementById('acfId').value = '';
      document.getElementById('acfHobbs').value = '0.0';
      document.getElementById('acfError').classList.add('d-none');
      new bootstrap.Modal(document.getElementById('aircraftFormModal')).show();
    });
  }

  async function editAircraft(id) {
    try {
      const ac = await api(`/api/aircraft/${id}`);
      document.getElementById('acFormTitle').innerHTML = '<i class="bi bi-pencil"></i> Edit Aircraft';
      document.getElementById('acfId').value = ac.id;
      document.getElementById('acfTail').value = ac.tail_number;
      document.getElementById('acfMake').value = ac.make;
      document.getElementById('acfModel').value = ac.model;
      document.getElementById('acfYear').value = ac.year || '';
      document.getElementById('acfHobbs').value = ac.last_hobbs ? Number(ac.last_hobbs).toFixed(1) : '0.0';
      document.getElementById('acfError').classList.add('d-none');
      new bootstrap.Modal(document.getElementById('aircraftFormModal')).show();
    } catch (err) {
      alert(err.message);
    }
  };

  async function deleteAircraft(id) {
    if (!confirm('Delete this aircraft? All its reservations and issues will also be deleted.')) return;
    try {
      await api(`/api/aircraft/${id}`, { method: 'DELETE' });
      await loadAircraftManagement();
      await loadAircraft();
    } catch (err) {
      alert(err.message);
    }
  };

  // Submit aircraft add/edit form
  const submitAircraftFormBtn = document.getElementById('submitAircraftForm');
  if (submitAircraftFormBtn) {
    submitAircraftFormBtn.addEventListener('click', async () => {
      const btn = submitAircraftFormBtn;
      const spinner = document.getElementById('acfSpinner');
      const errDiv = document.getElementById('acfError');
      errDiv.classList.add('d-none');

      const id = document.getElementById('acfId').value;
      const payload = {
        tail_number: document.getElementById('acfTail').value.trim(),
        make: document.getElementById('acfMake').value.trim(),
        model: document.getElementById('acfModel').value.trim(),
        year: document.getElementById('acfYear').value ? parseInt(document.getElementById('acfYear').value, 10) : null,
        last_hobbs: parseFloat(document.getElementById('acfHobbs').value) || 0,
      };

      if (!payload.tail_number || !payload.make || !payload.model) {
        errDiv.textContent = 'Tail number, make, and model are required';
        errDiv.classList.remove('d-none');
        return;
      }

      btn.disabled = true;
      spinner.classList.remove('d-none');
      try {
        if (id) {
          await api(`/api/aircraft/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/aircraft', { method: 'POST', body: JSON.stringify(payload) });
        }
        bootstrap.Modal.getInstance(document.getElementById('aircraftFormModal')).hide();
        await loadAircraftManagement();
        await loadAircraft();
      } catch (err) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
      }
    });
  }

  // ---------- Usage Report ----------
  const exportUsageBtn = document.getElementById('exportUsage');
  if (exportUsageBtn) {
    exportUsageBtn.addEventListener('click', () => {
      const errDiv = document.getElementById('usageError');
      errDiv.classList.add('d-none');
      const startDate = document.getElementById('usageStart').value;
      const endDate = document.getElementById('usageEnd').value;
      const acId = document.getElementById('usageAircraft').value;

      if (!startDate || !endDate) {
        errDiv.textContent = 'Please select both start and end dates';
        errDiv.classList.remove('d-none');
        return;
      }
      if (new Date(endDate) < new Date(startDate)) {
        errDiv.textContent = 'End date must be on or after start date';
        errDiv.classList.remove('d-none');
        return;
      }

      const params = new URLSearchParams({ start: startDate, end: endDate + 'T23:59:59' });
      if (acId) params.append('aircraft_id', acId);

      const url = `/api/reservations/usage-csv?${params}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'usage-report.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  // ---------- Init ----------
  (async () => {
    const userEl = document.querySelector('[data-user-id]');
    if (userEl) {
      currentUserId = parseInt(userEl.dataset.userId, 10);
      currentUserPrivileges = userEl.dataset.userPrivileges;
    }

    await loadAircraft();

    // Default usage date range: last 30 days
    const today = new Date();
    const thirtyAgo = new Date();
    thirtyAgo.setDate(today.getDate() - 30);
    document.getElementById('usageEnd').value = today.toISOString().slice(0, 10);
    document.getElementById('usageStart').value = thirtyAgo.toISOString().slice(0, 10);

    if (currentUserPrivileges === 'admin') {
      await loadAllUsers();
      await loadAircraftManagement();
    }
  })();
});
