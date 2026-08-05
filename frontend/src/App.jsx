import { useState } from "react";
import "./App.css";
import useStore from "./store/useStore";
import SetupPanel from "./components/SetupPanel";
import CRUDPanel from "./components/CRUDPanel";
import TimetablePanel from "./components/TimetablePanel";

const NAV = [
  { id: "setup", label: "Setup", icon: "⚙️" },
  { id: "subjects", label: "Subjects", icon: "📚" },
  { id: "teachers", label: "Teachers", icon: "👩‍🏫" },
  { id: "rooms", label: "Rooms", icon: "🏛️" },
  { id: "timetable", label: "Timetable", icon: "📅" },
];

export default function App() {
  const [tab, setTab] = useState("setup");
  const store = useStore();

  const counts = {
    subjects: store.subjects.length,
    teachers: store.teachers.length,
    rooms: store.rooms.length,
    timetable: store.timetable ? "✓" : "",
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">
          <span>🎓</span> TimetableAI
        </div>
        <span className="topbar-sub">Clash-free scheduling — CSP + Simulated Annealing</span>
      </header>

      <div className="main-layout">
        <nav className="sidebar">
          <div className="sidebar-label">Navigation</div>
          <div className="sidebar-section">
            {NAV.map(n => (
              <button key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
                <span>{n.icon}</span>
                <span>{n.label}</span>
                {counts[n.id] ? <span className="nav-badge">{counts[n.id]}</span> : null}
              </button>
            ))}
          </div>

          <div className="sidebar-label" style={{ marginTop: "1rem" }}>Algorithm</div>
          <div className="sidebar-section" style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.8 }}>
            <div>🔐 CSP Backtracking</div>
            <div>🌡️ + Simulated Annealing</div>
          </div>
        </nav>

        <main className="content-area">
          {tab === "setup" && (
            <SetupPanel config={store.config} setConfig={store.setConfig} loadDemo={store.loadDemo} />
          )}
          {tab === "subjects" && (
            <CRUDPanel type="subject" items={store.subjects}
              onAdd={store.addSubject} onUpdate={store.updateSubject} onDelete={store.deleteSubject} />
          )}
          {tab === "teachers" && (
            <CRUDPanel type="teacher" items={store.teachers}
              onAdd={store.addTeacher} onUpdate={store.updateTeacher} onDelete={store.deleteTeacher}
              subjects={store.subjects} />
          )}
          {tab === "rooms" && (
            <CRUDPanel type="room" items={store.rooms}
              onAdd={store.addRoom} onUpdate={store.updateRoom} onDelete={store.deleteRoom} />
          )}
          {tab === "timetable" && (
            <TimetablePanel
              subjects={store.subjects} teachers={store.teachers} rooms={store.rooms}
              config={store.config} timetable={store.timetable}
              mlHistory={store.mlHistory} generating={store.generating}
              lastResult={store.lastResult} generate={store.generate}
            />
          )}
        </main>
      </div>
    </div>
  );
}
