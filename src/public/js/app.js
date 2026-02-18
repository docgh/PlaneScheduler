/* PlaneScheduler — Client-side application */
document.addEventListener('DOMContentLoaded', () => {
  let aircraft = [];
  let calendar;
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

  function resTypeColor(title) {
    if (title === 'Maintenance') return 'res-maintenance';
    return 'res-personal'; // Personal and Shared both blue
  }

  function severityBadge(severity) {
    return `<span class="badge badge-${severity}">${severity}</span>`;
  }

  function formatDT(dt) {
    return new Date(dt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  // ---------- Aircraft ----------
  async function loadAircraft() {
    aircraft = await api('/api/aircraft');
    const selectors = ['#aircraftSelect', '#resAircraft', '#issAircraft'];
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;
      // Keep first option if it's "All Aircraft"
      const keepFirst = sel === '#aircraftSelect';
      const firstOpt = keepFirst ? el.options[0] : null;
      el.innerHTML = '';
      if (firstOpt) el.appendChild(firstOpt);

      aircraft.forEach(ac => {
        const opt = document.createElement('option');
        opt.value = ac.id;
        opt.textContent = `${ac.tail_number} — ${ac.make} ${ac.model}`;
        el.appendChild(opt);
      });
    });
  }

  // ---------- Calendar ----------
  function initCalendar() {
    const calEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calEl, {
      initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      },
      nowIndicator: true,
      selectable: true,
      eventClick: handleEventClick,
      select: handleDateSelect,
      events: fetchEvents,
      windowResize: (arg) => {
        if (window.innerWidth < 768) {
          calendar.changeView('listWeek');
        }
      },
      loading: (isLoading) => {
        // could add spinner
      },
    });
    calendar.render();
  }

  async function fetchEvents(info, successCallback, failureCallback) {
    try {
      const selectedAc = document.getElementById('aircraftSelect').value;
      const params = new URLSearchParams({
        start: info.startStr,
        end: info.endStr,
      });
      if (selectedAc) params.append('aircraft_id', selectedAc);
      const reservations = await api(`/api/reservations?${params}`);
      const events = reservations.map(r => ({
        id: r.id,
        title: `${r.tail_number}: ${r.title}`,
        start: r.start_time,
        end: r.end_time,
        classNames: [r.completed_at ? 'ac-completed' : resTypeColor(r.title)],
        extendedProps: { ...r },
      }));
      successCallback(events);
    } catch (err) {
      failureCallback(err);
    }
  }

  function handleDateSelect(info) {
    // Reset form for create mode
    document.getElementById('resId').value = '';
    document.getElementById('reservationForm').reset();
    document.getElementById('resModalTitle').innerHTML = '<i class="bi bi-calendar-plus"></i> New Reservation';
    document.getElementById('resBtnLabel').textContent = 'Create Reservation';
    document.getElementById('resError').classList.add('d-none');
    document.getElementById('resStart').value = toLocalISO(info.start);
    document.getElementById('resEnd').value = toLocalISO(info.end);
    const modal = new bootstrap.Modal(document.getElementById('reservationModal'));
    modal.show();
  }

  function handleEventClick(info) {
    const r = info.event.extendedProps;
    document.getElementById('detailTitle').textContent = `${r.title} Reservation`;

    let hobbsHtml = '';
    if (r.completed_at) {
      hobbsHtml = `
        <tr><th>Hobbs Start</th><td>${Number(r.start_hobbs).toFixed(1)}</td></tr>
        <tr><th>Hobbs End</th><td>${Number(r.end_hobbs).toFixed(1)}</td></tr>
        <tr><th>Completed</th><td>${formatDT(r.completed_at)}</td></tr>
      `;
    }

    document.getElementById('detailBody').innerHTML = `
      <table class="table table-sm">
        <tr><th>Type</th><td>${escapeHtml(r.title)}</td></tr>
        <tr><th>Aircraft</th><td>${r.tail_number} (${r.make} ${r.model})</td></tr>
        <tr><th>Reserved by</th><td>${r.username}</td></tr>
        <tr><th>Start</th><td>${formatDT(r.start_time)}</td></tr>
        <tr><th>End</th><td>${formatDT(r.end_time)}</td></tr>
        ${r.notes ? `<tr><th>Notes</th><td>${escapeHtml(r.notes)}</td></tr>` : ''}
        ${hobbsHtml}
      </table>
      ${r.completed_at ? '<span class="badge bg-success"><i class="bi bi-check-circle"></i> Completed</span>' : ''}
    `;

    const delBtn = document.getElementById('deleteReservation');
    const compBtn = document.getElementById('completeReservation');
    const editBtn = document.getElementById('editReservation');

    const canEdit = !r.completed_at && (r.user_id === currentUserId || currentUserPrivileges === 'admin');

    // Show edit button for owner or admin on non-completed reservations
    if (canEdit) {
      editBtn.classList.remove('d-none');
      editBtn.onclick = () => {
        bootstrap.Modal.getInstance(document.getElementById('reservationDetailModal')).hide();
        // Set up form in edit mode
        document.getElementById('resId').value = r.id;
        document.getElementById('resModalTitle').innerHTML = '<i class="bi bi-pencil"></i> Edit Reservation';
        document.getElementById('resBtnLabel').textContent = 'Save Changes';
        document.getElementById('resAircraft').value = r.aircraft_id;
        document.getElementById('resTitle').value = r.title;
        document.getElementById('resStart').value = toLocalISO(r.start_time);
        document.getElementById('resEnd').value = toLocalISO(r.end_time);
        document.getElementById('resNotes').value = r.notes || '';
        document.getElementById('resError').classList.add('d-none');
        new bootstrap.Modal(document.getElementById('reservationModal')).show();
      };
    } else {
      editBtn.classList.add('d-none');
    }

    // Show delete for owner or admin on non-completed reservations
    if (canEdit) {
      delBtn.classList.remove('d-none');
      delBtn.onclick = async () => {
        if (!confirm('Delete this reservation?')) return;
        try {
          await api(`/api/reservations/${r.id}`, { method: 'DELETE' });
          bootstrap.Modal.getInstance(document.getElementById('reservationDetailModal')).hide();
          calendar.refetchEvents();
        } catch (err) {
          alert(err.message);
        }
      };
    } else {
      delBtn.classList.add('d-none');
    }

    // Show complete button only if not completed and user is owner, admin, or maintainer
    const canComplete = !r.completed_at && (r.user_id === currentUserId || currentUserPrivileges === 'admin' || currentUserPrivileges === 'maintainer');
    if (canComplete) {
      compBtn.classList.remove('d-none');
      compBtn.onclick = () => {
        // Close detail modal
        bootstrap.Modal.getInstance(document.getElementById('reservationDetailModal')).hide();
        // Pre-populate Hobbs start from aircraft lastHobbs
        document.getElementById('compStartHobbs').value = r.last_hobbs ? Number(r.last_hobbs).toFixed(1) : '0.0';
        document.getElementById('compEndHobbs').value = '';
        document.getElementById('compError').classList.add('d-none');
        // Store reservation id for submission
        document.getElementById('completeForm').dataset.reservationId = r.id;
        const compModal = new bootstrap.Modal(document.getElementById('completeModal'));
        compModal.show();
      };
    } else {
      compBtn.classList.add('d-none');
    }

    new bootstrap.Modal(document.getElementById('reservationDetailModal')).show();
  }

  function toLocalISO(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  // ---------- Reservation form ----------
  // When start time is set and end time is empty, default end to 2 hours later
  const resStartInput = document.getElementById('resStart');
  const resEndInput = document.getElementById('resEnd');
  if (resStartInput && resEndInput) {
    resStartInput.addEventListener('change', () => {
      if (resEndInput.value) return;
      const v = resStartInput.value;
      if (!v) return;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return;
      d.setHours(d.getHours() + 2);
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const min = pad(d.getMinutes());
      resEndInput.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    });
  }

  document.getElementById('submitReservation').addEventListener('click', async () => {
    const btn = document.getElementById('submitReservation');
    const spinner = document.getElementById('resSpinner');
    const errDiv = document.getElementById('resError');
    errDiv.classList.add('d-none');

    const payload = {
      aircraft_id: parseInt(document.getElementById('resAircraft').value, 10),
      title: document.getElementById('resTitle').value,
      start_time: document.getElementById('resStart').value,
      end_time: document.getElementById('resEnd').value,
      notes: document.getElementById('resNotes').value.trim(),
    };

    if (!payload.aircraft_id || !payload.title || !payload.start_time || !payload.end_time) {
      errDiv.textContent = 'Please fill in all required fields';
      errDiv.classList.remove('d-none');
      return;
    }
    if (new Date(payload.end_time) <= new Date(payload.start_time)) {
      errDiv.textContent = 'End time must be after start time';
      errDiv.classList.remove('d-none');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('d-none');
    try {
      const editId = document.getElementById('resId').value;
      if (editId) {
        // Edit mode
        await api(`/api/reservations/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        // Create mode
        await api('/api/reservations', { method: 'POST', body: JSON.stringify(payload) });
      }
      bootstrap.Modal.getInstance(document.getElementById('reservationModal')).hide();
      document.getElementById('reservationForm').reset();
      document.getElementById('resId').value = '';
      calendar.refetchEvents();
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // ---------- Issues ----------
  function updateGroundedBanner(issues) {
    const banner = document.getElementById('groundedBanner');
    const listEl = document.getElementById('groundedList');
    if (!banner || !listEl) return;

    // Find aircraft with open grounding issues
    const groundedMap = new Map();
    issues.forEach(i => {
      if (i.severity === 'grounding' && i.status !== 'resolved') {
        if (!groundedMap.has(i.aircraft_id)) {
          groundedMap.set(i.aircraft_id, i.tail_number);
        }
      }
    });

    if (groundedMap.size === 0) {
      banner.classList.add('d-none');
      return;
    }

    listEl.innerHTML = Array.from(groundedMap.values()).map(tail =>
      `<span class="grounded-aircraft">${escapeHtml(tail)}</span>`
    ).join(' ');
    banner.classList.remove('d-none');
  }

  async function loadIssues() {
    const selectedAc = document.getElementById('aircraftSelect').value;
    const params = selectedAc ? `?aircraft_id=${selectedAc}` : '';
    const issues = await api(`/api/issues${params}`);

    // Always check all issues for grounded banner (regardless of aircraft filter)
    if (selectedAc) {
      const allIssues = await api('/api/issues');
      updateGroundedBanner(allIssues);
    } else {
      updateGroundedBanner(issues);
    }

    const list = document.getElementById('issueList');
    const count = document.getElementById('issueCount');
    const openIssues = issues.filter(i => i.status !== 'resolved');
    count.textContent = openIssues.length;

    if (issues.length === 0) {
      list.innerHTML = '<div class="list-group-item text-muted text-center py-4">No issues reported</div>';
      return;
    }

    list.innerHTML = issues.map(issue => {
      const canManageIssues = (currentUserPrivileges === 'admin' || currentUserPrivileges === 'maintainer');
      return `
      <div class="list-group-item issue-item ${issue.status === 'resolved' ? 'list-group-item-light' : ''}">
        <div class="issue-info">
          <div class="issue-title">
            ${severityBadge(issue.severity)} ${escapeHtml(issue.title)}
          </div>
          <div class="issue-meta">
            ${issue.tail_number} &middot; ${issue.reported_by_name} &middot;
            ${new Date(issue.created_at).toLocaleDateString()} &middot;
            <em>${issue.status.replace('_', ' ')}</em>
          </div>
          ${issue.description ? `<div class="issue-meta mt-1">${escapeHtml(issue.description)}</div>` : ''}
        </div>
        ${canManageIssues ? `
        <div class="issue-actions">
          ${issue.status !== 'resolved' ? `
            <button class="btn btn-sm btn-outline-success" title="Resolve" onclick="resolveIssue(${issue.id})">
              <i class="bi bi-check-lg"></i>
            </button>` : ''}
          <button class="btn btn-sm btn-outline-danger" title="Delete" onclick="deleteIssue(${issue.id})">
            <i class="bi bi-trash"></i>
          </button>
        </div>` : ''}
      </div>
    `;
    }).join('');
  }

  window.resolveIssue = async (id) => {
    try {
      await api(`/api/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
      loadIssues();
    } catch (err) {
      alert(err.message);
    }
  };

  window.deleteIssue = async (id) => {
    if (!confirm('Delete this issue?')) return;
    try {
      await api(`/api/issues/${id}`, { method: 'DELETE' });
      loadIssues();
    } catch (err) {
      alert(err.message);
    }
  };

  // Issue form submission
  document.getElementById('submitIssue').addEventListener('click', async () => {
    const btn = document.getElementById('submitIssue');
    const spinner = document.getElementById('issSpinner');
    const errDiv = document.getElementById('issError');
    errDiv.classList.add('d-none');

    const payload = {
      aircraft_id: parseInt(document.getElementById('issAircraft').value, 10),
      title: document.getElementById('issTitle').value.trim(),
      severity: document.getElementById('issSeverity').value,
      description: document.getElementById('issDescription').value.trim(),
    };

    if (!payload.aircraft_id || !payload.title) {
      errDiv.textContent = 'Please fill in all required fields';
      errDiv.classList.remove('d-none');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('d-none');
    try {
      await api('/api/issues', { method: 'POST', body: JSON.stringify(payload) });
      bootstrap.Modal.getInstance(document.getElementById('issueModal')).hide();
      document.getElementById('issueForm').reset();
      loadIssues();
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // ---------- Aircraft selector change ----------
  document.getElementById('aircraftSelect').addEventListener('change', () => {
    calendar.refetchEvents();
    loadIssues();
  });

  // ---------- Complete reservation form ----------
  document.getElementById('submitComplete').addEventListener('click', async () => {
    const btn = document.getElementById('submitComplete');
    const spinner = document.getElementById('compSpinner');
    const errDiv = document.getElementById('compError');
    errDiv.classList.add('d-none');

    const reservationId = document.getElementById('completeForm').dataset.reservationId;
    const start_hobbs = parseFloat(document.getElementById('compStartHobbs').value);
    const end_hobbs = parseFloat(document.getElementById('compEndHobbs').value);

    if (isNaN(start_hobbs) || isNaN(end_hobbs)) {
      errDiv.textContent = 'Please enter valid Hobbs values';
      errDiv.classList.remove('d-none');
      return;
    }
    if (end_hobbs < start_hobbs) {
      errDiv.textContent = 'Hobbs end must be greater than or equal to Hobbs start';
      errDiv.classList.remove('d-none');
      return;
    }

    btn.disabled = true;
    spinner.classList.remove('d-none');
    try {
      await api(`/api/reservations/${reservationId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ start_hobbs, end_hobbs }),
      });
      bootstrap.Modal.getInstance(document.getElementById('completeModal')).hide();
      document.getElementById('completeForm').reset();
      calendar.refetchEvents();
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('d-none');
    } finally {
      btn.disabled = false;
      spinner.classList.add('d-none');
    }
  });

  // ---------- Utility ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Init ----------
  (async () => {
    // Extract current user id and privileges from data attributes
    const userEl = document.querySelector('[data-user-id]');
    if (userEl) {
      currentUserId = parseInt(userEl.dataset.userId, 10);
      currentUserPrivileges = userEl.dataset.userPrivileges;
    }

    await loadAircraft();
    initCalendar();
    await loadIssues();

    // New Reservation button — reset form to create mode
    document.getElementById('newReservationBtn').addEventListener('click', () => {
      document.getElementById('resId').value = '';
      document.getElementById('reservationForm').reset();
      document.getElementById('resModalTitle').innerHTML = '<i class=\"bi bi-calendar-plus\"></i> New Reservation';
      document.getElementById('resBtnLabel').textContent = 'Create Reservation';
      document.getElementById('resError').classList.add('d-none');
      new bootstrap.Modal(document.getElementById('reservationModal')).show();
    });
    await loadSubscriptions();

    // Admin: wire up Manage Users button
    const manageUsersBtn = document.getElementById('manageUsersBtn');
    if (manageUsersBtn) {
      manageUsersBtn.addEventListener('click', async () => {
        await loadAllUsers();
        new bootstrap.Modal(document.getElementById('userManagementModal')).show();
      });
    }

    // Admin: wire up Manage Aircraft button
    const manageAircraftBtn = document.getElementById('manageAircraftBtn');
    if (manageAircraftBtn) {
      manageAircraftBtn.addEventListener('click', async () => {
        await loadAircraftManagement();
        new bootstrap.Modal(document.getElementById('aircraftManagementModal')).show();
      });
    }
    // Admin/Maintainer: wire up Usage Report button
    const usageReportBtn = document.getElementById('usageReportBtn');
    if (usageReportBtn) {
      usageReportBtn.addEventListener('click', () => {
        // Populate aircraft dropdown
        const sel = document.getElementById('usageAircraft');
        sel.innerHTML = '<option value="">All Aircraft</option>';
        aircraft.forEach(ac => {
          const opt = document.createElement('option');
          opt.value = ac.id;
          opt.textContent = `${ac.tail_number} — ${ac.make} ${ac.model}`;
          sel.appendChild(opt);
        });
        // Default date range: last 30 days
        const today = new Date();
        const thirtyAgo = new Date();
        thirtyAgo.setDate(today.getDate() - 30);
        document.getElementById('usageEnd').value = today.toISOString().slice(0, 10);
        document.getElementById('usageStart').value = thirtyAgo.toISOString().slice(0, 10);
        document.getElementById('usageError').classList.add('d-none');
        new bootstrap.Modal(document.getElementById('usageReportModal')).show();
      });
    }

    // Export Usage CSV
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

        // Trigger download via hidden link
        const url = `/api/reservations/usage-csv?${params}`;
        const a = document.createElement('a');
        a.href = url;
        a.download = 'usage-report.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    }
  })();

  // ---------- Notification Subscriptions ----------
  let subscriptions = new Set();

  async function loadSubscriptions() {
    try {
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
        <div class="form-check form-check-inline me-4">
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
          e.target.checked = !e.target.checked; // revert
          alert(err.message);
        } finally {
          e.target.disabled = false;
        }
      });
    });
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
              <strong>${escapeHtml(u.username)}</strong>
              <span class="text-muted ms-2">${escapeHtml(u.email)}</span>
              <small class="text-muted ms-2">${new Date(u.created_at).toLocaleDateString()}</small>
            </div>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success" onclick="approveUser(${u.id}, 'user')" title="Approve as User">
                <i class="bi bi-check-lg"></i> Approve
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="rejectUser(${u.id})" title="Reject">
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
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td><span class="badge bg-${u.privileges === 'admin' ? 'danger' : u.privileges === 'maintainer' ? 'warning text-dark' : u.privileges === 'pending' ? 'secondary' : 'primary'}">${u.privileges}</span></td>
            <td>
              <div class="d-flex gap-1">
                <button class="btn btn-sm btn-outline-primary" onclick="editUser(${u.id})" title="Edit">
                  <i class="bi bi-pencil"></i>
                </button>
                ${isSelf ? '' :
                  `<button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${u.id})" title="Delete">
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

  window.editUser = async (id) => {
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

  window.approveUser = async (id, privileges) => {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ privileges }) });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  window.rejectUser = async (id) => {
    if (!confirm('Reject and delete this user?')) return;
    try {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  window.changeUserPrivileges = async (id, privileges) => {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ privileges }) });
      await loadAllUsers();
    } catch (err) {
      alert(err.message);
      await loadAllUsers();
    }
  };

  window.deleteUser = async (id) => {
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
              <button class="btn btn-sm btn-outline-primary" onclick="editAircraft(${ac.id})" title="Edit">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteAircraft(${ac.id})" title="Delete">
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

  window.editAircraft = async (id) => {
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

  window.deleteAircraft = async (id) => {
    if (!confirm('Delete this aircraft? All its reservations and issues will also be deleted.')) return;
    try {
      await api(`/api/aircraft/${id}`, { method: 'DELETE' });
      await loadAircraftManagement();
      // Refresh the aircraft dropdowns on the main page
      await loadAircraft();
      calendar.refetchEvents();
      loadIssues();
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
        // Refresh aircraft dropdowns on main page
        await loadAircraft();
        calendar.refetchEvents();
      } catch (err) {
        errDiv.textContent = err.message;
        errDiv.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
      }
    });
  }
});
