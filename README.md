# PlaneScheduler

Aircraft reservation scheduling system with a calendar view, issue tracking, user authentication, and email notifications.

## Features

- **Calendar View** — Interactive calendar (FullCalendar) showing all aircraft reservations; month, week, and list views; click dates to create reservations
- **Reservations** — Create, view, and delete reservations with conflict detection
- **Aircraft Issues** — Report, resolve, and delete maintenance/squawk issues per aircraft with severity levels
- **User Authentication** — Register/login with bcrypt-hashed passwords and session-based auth
- **Email Notifications** — All users are notified via email when a new reservation is created
- **Responsive Design** — Works on desktop and mobile (Bootstrap 5)
- **Docker Support** — `Dockerfile` and `docker-compose.yml` included

## Quick Start (Docker)

```bash
# Clone the repo
git clone <repo-url> && cd PlaneScheduler

# Start MySQL + App
docker compose up -d --build

# App available at http://localhost:3000
```

Default login: `admin` / `admin123`

## Quick Start (Local Development)

### Prerequisites

- Node.js 18+
- MySQL 8.0+

### Setup

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your MySQL and SMTP credentials

# Start the app
npm run dev
```

The database tables are created automatically on first run.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `planescheduler` |
| `DB_PASSWORD` | MySQL password | — |
| `DB_NAME` | MySQL database | `plane_scheduler` |
| `SESSION_SECRET` | Express session secret | — |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_SECURE` | Use TLS | `false` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password | — |
| `SMTP_FROM` | From address for emails | — |

## Project Structure

```
PlaneScheduler/
├── src/
│   ├── config/         # Database pool, Passport config
│   ├── db/             # SQL schema, DB initializer
│   ├── middleware/      # Auth guard
│   ├── public/         # Static CSS & JS
│   ├── routes/         # Express route handlers
│   ├── services/       # Email notification service
│   ├── views/          # EJS templates
│   └── server.js       # Application entry point
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Login |
| POST | `/auth/register` | Register new user |
| GET | `/auth/logout` | Logout |
| GET | `/api/aircraft` | List all aircraft |
| GET | `/api/reservations` | List reservations (query: `aircraft_id`, `start`, `end`) |
| POST | `/api/reservations` | Create reservation |
| DELETE | `/api/reservations/:id` | Delete own reservation |
| GET | `/api/issues` | List issues (query: `aircraft_id`) |
| POST | `/api/issues` | Report new issue |
| PATCH | `/api/issues/:id` | Update issue status |
| DELETE | `/api/issues/:id` | Delete issue |

## Database Schema

- **users** — `id`, `username`, `password` (bcrypt), `email`, `created_at`
- **aircraft** — `id`, `tail_number`, `make`, `model`, `year`, `created_at`
- **reservations** — `id`, `aircraft_id`, `user_id`, `title`, `start_time`, `end_time`, `notes`, `created_at`
- **aircraft_issues** — `id`, `aircraft_id`, `reported_by`, `title`, `description`, `severity`, `status`, `created_at`, `resolved_at`
