const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIcalUtc(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function unfoldPath(path) {
  if (!path) return '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="PlaneScheduler CalDAV", charset="UTF-8"');
  return res.status(401).send('Authentication required');
}

async function authenticateCaldav(req, res, next) {
  try {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) {
      return unauthorized(res);
    }

    const encoded = auth.slice('Basic '.length).trim();
    let decoded;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch (_err) {
      return unauthorized(res);
    }

    const splitAt = decoded.indexOf(':');
    if (splitAt < 1) {
      return unauthorized(res);
    }

    const username = decoded.slice(0, splitAt);
    const password = decoded.slice(splitAt + 1);

    const [rows] = await pool.query(
      'SELECT id, username, email, privileges, password FROM users WHERE username = ?',
      [username]
    );

    if (!rows.length) {
      return unauthorized(res);
    }

    const user = rows[0];
    if (user.privileges === 'pending') {
      return unauthorized(res);
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return unauthorized(res);
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      privileges: user.privileges,
    };
    return next();
  } catch (err) {
    console.error('CalDAV auth error:', err);
    return res.status(500).send('Authentication failed');
  }
}

async function getReservationRows() {
  const [rows] = await pool.query(
    `SELECT r.id, r.title, r.start_time, r.end_time, r.notes, r.created_at,
            a.tail_number, a.make, a.model,
            u.username
       FROM reservations r
       JOIN aircraft a ON r.aircraft_id = a.id
       JOIN users u ON r.user_id = u.id
      ORDER BY r.start_time ASC`
  );
  return rows;
}

function buildCalendarIcs(rows, host) {
  const stamp = toIcalUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//PlaneScheduler//Reservations//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:PlaneScheduler Reservations',
  ];

  rows.forEach((row) => {
    const summaryWho = (row.title === 'Maintenance' || row.title === 'Shared') ? row.title : row.username;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:reservation-${row.id}@${host}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcalUtc(row.start_time)}`);
    lines.push(`DTEND:${toIcalUtc(row.end_time)}`);
    lines.push(`SUMMARY:${row.tail_number} - ${summaryWho}`);
    lines.push(`DESCRIPTION:${(row.notes || '').replace(/\r?\n/g, '\\n')}`);
    lines.push(`ORGANIZER;CN=${row.username}:MAILTO:no-reply@${host}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function multistatus(body) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cal="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
}

router.use(authenticateCaldav);

router.use((req, res, next) => {
  res.set('DAV', '1, calendar-access');
  res.set('Allow', 'OPTIONS, PROPFIND, REPORT, GET, HEAD');
  next();
});

router.all('*', async (req, res) => {
  const method = (req.method || '').toUpperCase();
  const rootPath = '/caldav';
  const path = unfoldPath(req.path);
  const username = req.user.username;
  const principalPath = `${rootPath}/principals/${username}`;
  const calendarPath = `${rootPath}/calendars/${username}/reservations`;

  if (['POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL', 'MKCALENDAR', 'MOVE', 'COPY'].includes(method)) {
    return res.status(405).send('Read-only CalDAV endpoint');
  }

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (method === 'GET' || method === 'HEAD') {
    if (path !== '/calendars/' + username + '/reservations') {
      return res.status(404).send('Not found');
    }

    try {
      const rows = await getReservationRows();
      const ics = buildCalendarIcs(rows, req.get('host'));
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('ETag', `W/"reservations-${rows.length}"`);
      if (method === 'HEAD') return res.status(200).end();
      return res.status(200).send(ics);
    } catch (err) {
      console.error('CalDAV GET error:', err);
      return res.status(500).send('Failed to build calendar');
    }
  }

  if (method === 'PROPFIND') {
    const depth = req.get('Depth') || '0';

    if (path === '/' || path === '') {
      const body = `
        <d:response>
          <d:href>${escapeXml(rootPath + '/')}</d:href>
          <d:propstat>
            <d:prop>
              <d:current-user-principal>
                <d:href>${escapeXml(principalPath + '/')}</d:href>
              </d:current-user-principal>
              <d:resourcetype><d:collection/></d:resourcetype>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>`;
      return res.status(207).type('application/xml; charset=utf-8').send(multistatus(body));
    }

    if (path === '/principals/' + username) {
      const body = `
        <d:response>
          <d:href>${escapeXml(principalPath + '/')}</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>${escapeXml(username)}</d:displayname>
              <cal:calendar-home-set>
                <d:href>${escapeXml(rootPath + '/calendars/' + username + '/')}</d:href>
              </cal:calendar-home-set>
              <d:resourcetype><d:principal/></d:resourcetype>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>`;
      return res.status(207).type('application/xml; charset=utf-8').send(multistatus(body));
    }

    if (path === '/calendars/' + username || (path === '/calendars/' + username + '/reservations' && depth === '1')) {
      const body = `
        <d:response>
          <d:href>${escapeXml(rootPath + '/calendars/' + username + '/')}</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
              <d:displayname>Reservations</d:displayname>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
        <d:response>
          <d:href>${escapeXml(calendarPath + '/')}</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
              <d:displayname>Reservations</d:displayname>
              <cal:supported-calendar-component-set>
                <cal:comp name="VEVENT"/>
              </cal:supported-calendar-component-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>`;
      return res.status(207).type('application/xml; charset=utf-8').send(multistatus(body));
    }

    if (path === '/calendars/' + username + '/reservations') {
      const body = `
        <d:response>
          <d:href>${escapeXml(calendarPath + '/')}</d:href>
          <d:propstat>
            <d:prop>
              <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
              <d:displayname>Reservations</d:displayname>
              <cal:supported-calendar-component-set>
                <cal:comp name="VEVENT"/>
              </cal:supported-calendar-component-set>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>`;
      return res.status(207).type('application/xml; charset=utf-8').send(multistatus(body));
    }

    return res.status(404).send('Not found');
  }

  if (method === 'REPORT') {
    if (path !== '/calendars/' + username + '/reservations') {
      return res.status(404).send('Not found');
    }

    try {
      const rows = await getReservationRows();
      const events = rows.map((row) => {
        const summaryWho = (row.title === 'Maintenance' || row.title === 'Shared') ? row.title : row.username;
        const eventIcs = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//PlaneScheduler//Reservations//EN',
          'BEGIN:VEVENT',
          `UID:reservation-${row.id}@${req.get('host')}`,
          `DTSTAMP:${toIcalUtc(new Date())}`,
          `DTSTART:${toIcalUtc(row.start_time)}`,
          `DTEND:${toIcalUtc(row.end_time)}`,
          `SUMMARY:${row.tail_number} - ${summaryWho}`,
          `DESCRIPTION:${(row.notes || '').replace(/\r?\n/g, '\\n')}`,
          'END:VEVENT',
          'END:VCALENDAR',
          ''
        ].join('\r\n');

        return `
          <d:response>
            <d:href>${escapeXml(calendarPath + '/reservation-' + row.id + '.ics')}</d:href>
            <d:propstat>
              <d:prop>
                <d:getetag>"reservation-${row.id}"</d:getetag>
                <cal:calendar-data>${escapeXml(eventIcs)}</cal:calendar-data>
              </d:prop>
              <d:status>HTTP/1.1 200 OK</d:status>
            </d:propstat>
          </d:response>`;
      }).join('');

      return res.status(207).type('application/xml; charset=utf-8').send(multistatus(events));
    } catch (err) {
      console.error('CalDAV REPORT error:', err);
      return res.status(500).send('Failed to build report');
    }
  }

  return res.status(405).send('Method not allowed');
});

module.exports = router;
