# ZeroClash — AI TimeTable Management System

A full-stack web app that uses a **CSP Backtracking + Simulated Annealing** algorithm to generate clash-free college timetables with zero teacher/room conflicts.

---

## Algorithm

| Phase | Type | How it works |
|---|---|---|
| **1. CSP Backtracking** | Constraint-based | Assigns every lecture to a slot using backtracking with forward checking. Guarantees **zero** teacher/room double-bookings before anything else runs. |
| **2. Simulated Annealing** | Probabilistic local search | Polishes the clash-free schedule by swapping lecture slots. Accepts some worse moves while "hot" to escape local optima, then cools down and locks in the best schedule found — all while never reintroducing a hard clash. |

This replaces an earlier 4-algorithm version (GA / SA / CSP / Q-Learning). Three of those
were mostly for demo purposes and had a serialization bug that crashed the API for anything
but Q-Learning. This hybrid is simpler, faster, and optimizes directly for what the app
promises: a genuinely clash-free, well-balanced timetable.

### Penalty Function
```
penalty = 0
  + 1000 × (teacher double-booked in same slot)   ← hard constraint (always 0 after phase 1)
  + 1000 × (room double-booked in same slot)       ← hard constraint (always 0 after phase 1)
  + 50   × (lab assigned to non-lab room)          ← soft constraint
  + 20   × (theory in lab room)                    ← soft constraint
  + 15   × (back-to-back same subject same day)    ← soft constraint
  + 10   × (subject not spread across days)        ← soft constraint
```

---

## Project Structure

```
timetable-app/
├── backend/
│   ├── app.py              # Flask API + CSP + Simulated Annealing hybrid
│   └── requirements.txt
└── frontend/
    ├── public/index.html
    ├── package.json
    └── src/
        ├── App.jsx                      # Root component + sidebar nav
        ├── App.css                      # Dark theme design system
        ├── index.js                     # React entry point
        ├── store/useStore.js            # Global state + API calls
        └── components/
            ├── SetupPanel.jsx           # College config + day picker
            ├── CRUDPanel.jsx            # Subjects / Teachers / Rooms CRUD
            ├── TimetablePanel.jsx       # Generate / grid render / PDF export
            └── MLChart.jsx              # Recharts convergence visualizer
```

---

## Quick Start

### 1. Backend (Python / Flask)

```bash
cd timetable-app/backend
pip install -r requirements.txt
python app.py
# Running on http://localhost:5000
```

### 2. Frontend (React)

```bash
cd timetable-app/frontend
npm install
npm start
# Running on http://localhost:3000
```

### 3. Use the app

1. Open **http://localhost:3000**
2. Click **"Load demo data"** on the Setup tab — populates 9 subjects, 4 teachers, 4 rooms
3. Go to the **Timetable** tab, click **Generate timetable**
4. View the clash-free weekly grid + optimization convergence chart
5. Click **Export PDF** to directly download a printable timetable

---

## API Reference

### `POST /api/generate`

**Request body:**
```json
{
  "config": {
    "days": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
    "perday": 6,
    "dur": 60,
    "start": "09:00",
    "breakAfter": 3
  },
  "data": {
    "subjects": [{ "id":"s1", "name":"Data Structures", "code":"CS301", "lpw":3, "stype":"theory" }],
    "teachers": [{ "id":"t1", "name":"Dr. Sharma", "dept":"CSE", "subjects":["s1"] }],
    "rooms":    [{ "id":"r1", "name":"Room 101", "cap":60, "rtype":"classroom" }]
  }
}
```

**Response:**
```json
{
  "schedule": { "Sem 5|Monday|0": { "subject":"s1", "teacher":"t1", "room":"r1", "time":"09:00–10:00", "day":"Monday", "section":"Sem 5", "slotIndex":0 } },
  "penalty": 0,
  "clashFree": true,
  "history": [{ "iteration": 0, "penalty": 40 }, ...],
  "algorithm": "csp_sa_hybrid",
  "elapsed": 0.02,
  "slotTimes": ["09:00–10:00", "10:00–11:00", ...]
}
```

### `GET /api/health`
Returns `{ "status": "ok", "algorithm": "csp_sa_hybrid" }`

---

## Configuration Options

| Field | Description | Default |
|---|---|---|
| `days` | Working days array | Mon–Fri |
| `perday` | Lectures per day | 6 |
| `dur` | Lecture duration (minutes) | 60 |
| `start` | First lecture start time | 09:00 |
| `breakAfter` | Insert 20-min break after Nth lecture | 3 |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Recharts, jsPDF + jspdf-autotable |
| Backend | Python 3, Flask, Flask-CORS |
| Algorithm | Pure Python (no external ML libs needed) |
| Styling | Custom CSS design system (dark theme) |

---

## Extending the App

- **Add more subjects/teachers** — CRUD panels support unlimited entries
- **Multiple sections** — Add a `section` field to subjects and generate per-section
- **Teacher availability** — Add unavailable slots to teacher objects and check in `is_consistent()`
- **Database persistence** — Replace in-memory state with SQLite / PostgreSQL
- **Authentication** — Add Flask-Login for admin access
