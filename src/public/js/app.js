/* PlaneScheduler — Client-side application */
document.addEventListener('DOMContentLoaded', () => {
  let aircraft = [];
  let allUsers = [];
  let calendar;
  let currentUserId = null;
  let currentUserPrivileges = null;
  let currentUserUsername = null;

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

  // Capitalize first letter helper
  function capitalizeFirst(str) {
    if (str == null) return '';
    const s = String(str);
    if (s.length === 0) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
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

    // Hide aircraft selector if only one aircraft
    const selectRow = document.getElementById('aircraftSelectGroup');
    if (selectRow) {
      if (aircraft.length <= 1) {
        selectRow.style.display = 'none';
        if (aircraft.length === 1) {
          document.getElementById('aircraftSelect').value = aircraft[0].id;
        }
      } else {
        selectRow.style.display = '';
      }
    }
  }

  // ---------- Users for reservation assignment ----------
  async function loadUsersForDropdown() {
    if (currentUserPrivileges === 'admin') {
      try {
        allUsers = await api('/api/users');
      } catch {
        allUsers = [{ id: currentUserId, username: currentUserUsername }];
      }
    } else {
      allUsers = [{ id: currentUserId, username: currentUserUsername }];
    }
    populateResUserDropdown();
  }

  function populateResUserDropdown(selectedUserId) {
    const el = document.getElementById('resUser');
    if (!el) return;
    el.innerHTML = '';
    allUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = capitalizeFirst(u.username);
      el.appendChild(opt);
    });
    el.value = selectedUserId || currentUserId;
  }

  // ---------- Calendar ----------
  function initCalendar() {
    const calEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calEl, {
      themeSystem: 'bootstrap5',
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
      eventMouseEnter: handleEventMouseEnter,
      eventMouseLeave: handleEventMouseLeave,
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

  

  // ---------- Event hover tooltip ----------
  let tooltipEl = null;

  function handleEventMouseEnter(info) {
    const r = info.event.extendedProps;
    if (tooltipEl) tooltipEl.remove();

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'fc-tooltip';

    let html = `<div class="tt-header">${escapeHtml(r.title)} — ${escapeHtml(r.tail_number)}</div>`;
    html += `<div class="tt-row"><span class="tt-label">Aircraft:</span> ${escapeHtml(r.tail_number)} (${escapeHtml(r.make)} ${escapeHtml(r.model)})</div>`;
    html += `<div class="tt-row"><span class="tt-label">User:</span> ${escapeHtml(capitalizeFirst(r.username))}</div>`;
    html += `<div class="tt-row"><span class="tt-label">Start:</span> ${formatDT(r.start_time)}</div>`;
    html += `<div class="tt-row"><span class="tt-label">End:</span> ${formatDT(r.end_time)}</div>`;
    if (r.notes) html += `<div class="tt-row"><span class="tt-label">Notes:</span> ${escapeHtml(r.notes)}</div>`;
    if (r.completed_at) html += `<div class="tt-completed"><i class="bi bi-check-circle"></i> Completed</div>`;

    tooltipEl.innerHTML = html;
    document.body.appendChild(tooltipEl);

    const rect = info.el.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;

    // Keep tooltip within viewport
    const tooltipRect = tooltipEl.getBoundingClientRect();
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    if (top + tooltipRect.height > window.scrollY + window.innerHeight) {
      top = rect.top + window.scrollY - tooltipRect.height - 6;
    }

    tooltipEl.style.top = top + 'px';
    tooltipEl.style.left = left + 'px';
  }

  function handleEventMouseLeave() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
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
        title: `${r.tail_number}: ` + (r.title === 'Maintenance'  ? 'Maintenance' : capitalizeFirst(r.username)) + (r.notes ? ` - ${r.notes}` : ''),
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
    document.getElementById('resHobbsGroup').classList.add('d-none');
    document.getElementById('resStart').value = toLocalISO(info.start);
    document.getElementById('resEnd').value = toLocalISO(info.end);
    populateResUserDropdown();
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
        <tr><th>Aircraft</th><td>${escapeHtml(r.tail_number)} (${escapeHtml(r.make)} ${escapeHtml(r.model)})</td></tr>
        <tr><th>Reserved by</th><td>${escapeHtml(capitalizeFirst(r.username))}</td></tr>
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
    const uncompBtn = document.getElementById('uncompleteReservation');

    const isAdmin = currentUserPrivileges === 'admin';
    const isOwner = r.user_id === currentUserId;
    const canEdit = (!r.completed_at && (isOwner || isAdmin)) || (r.completed_at && isAdmin);

    // Show edit button for owner or admin on non-completed, or admin on completed
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
        populateResUserDropdown(r.user_id);
        document.getElementById('resStart').value = toLocalISO(r.start_time);
        document.getElementById('resEnd').value = toLocalISO(r.end_time);
        document.getElementById('resNotes').value = r.notes || '';
        document.getElementById('resError').classList.add('d-none');

        // Show hobbs fields for completed reservations being edited by admin
        const hobbsGroup = document.getElementById('resHobbsGroup');
        if (r.completed_at && isAdmin) {
          hobbsGroup.classList.remove('d-none');
          document.getElementById('resStartHobbs').value = r.start_hobbs != null ? Number(r.start_hobbs).toFixed(1) : '';
          document.getElementById('resEndHobbs').value = r.end_hobbs != null ? Number(r.end_hobbs).toFixed(1) : '';
        } else {
          hobbsGroup.classList.add('d-none');
          document.getElementById('resStartHobbs').value = '';
          document.getElementById('resEndHobbs').value = '';
        }

        new bootstrap.Modal(document.getElementById('reservationModal')).show();
      };
    } else {
      editBtn.classList.add('d-none');
    }

    // Show delete for owner or admin
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

    // Show uncomplete button for admin on completed reservations
    if (r.completed_at && isAdmin) {
      uncompBtn.classList.remove('d-none');
      uncompBtn.onclick = async () => {
        if (!confirm('Remove completed status from this reservation? Hobbs values will be cleared.')) return;
        try {
          await api(`/api/reservations/${r.id}/uncomplete`, { method: 'POST' });
          bootstrap.Modal.getInstance(document.getElementById('reservationDetailModal')).hide();
          calendar.refetchEvents();
        } catch (err) {
          alert(err.message);
        }
      };
    } else {
      uncompBtn.classList.add('d-none');
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
      user_id: parseInt(document.getElementById('resUser').value, 10),
      title: document.getElementById('resTitle').value,
      start_time: document.getElementById('resStart').value,
      end_time: document.getElementById('resEnd').value,
      notes: document.getElementById('resNotes').value.trim(),
    };

    // Include hobbs values if the hobbs fields are visible (admin editing completed)
    const hobbsGroup = document.getElementById('resHobbsGroup');
    if (!hobbsGroup.classList.contains('d-none')) {
      const sh = document.getElementById('resStartHobbs').value;
      const eh = document.getElementById('resEndHobbs').value;
      if (sh !== '' && eh !== '') {
        payload.start_hobbs = parseFloat(sh);
        payload.end_hobbs = parseFloat(eh);
      }
    }

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
      document.getElementById('resHobbsGroup').classList.add('d-none');
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
            <button class="btn btn-sm btn-outline-success" title="Resolve" data-action="resolve-issue" data-id="${issue.id}">
              <i class="bi bi-check-lg"></i>
            </button>` : ''}
          <button class="btn btn-sm btn-outline-danger" title="Delete" data-action="delete-issue" data-id="${issue.id}">
            <i class="bi bi-trash"></i>
          </button>
        </div>` : ''}
      </div>
    `;
    }).join('');
  }

  // ---------- Event delegation for dynamically created buttons ----------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);

    switch (action) {
      case 'resolve-issue': return resolveIssue(id);
      case 'delete-issue': return deleteIssue(id);
    }
  });

  async function resolveIssue(id) {
    try {
      await api(`/api/issues/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
      loadIssues();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteIssue(id) {
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
      currentUserUsername = userEl.dataset.userUsername;
    }

    await loadAircraft();
    await loadUsersForDropdown();
    initCalendar();
    await loadIssues();

    // New Reservation button — reset form to create mode
    document.getElementById('newReservationBtn').addEventListener('click', () => {
      document.getElementById('resId').value = '';
      document.getElementById('reservationForm').reset();
      document.getElementById('resModalTitle').innerHTML = '<i class=\"bi bi-calendar-plus\"></i> New Reservation';
      document.getElementById('resBtnLabel').textContent = 'Create Reservation';
      document.getElementById('resError').classList.add('d-none');
      document.getElementById('resHobbsGroup').classList.add('d-none');
      populateResUserDropdown();
      new bootstrap.Modal(document.getElementById('reservationModal')).show();
    });
  })();
});
