import { useState } from "react";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

export default function SetupPanel({ config, setConfig, loadDemo }) {
  const [saved, setSaved] = useState(false);

  const update = (key, val) => setConfig(c => ({ ...c, [key]: val }));

  const toggleDay = (day) => {
    const days = config.days.includes(day)
      ? config.days.filter(d => d !== day)
      : [...config.days, day];
    const ordered = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const sortedDays = days.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
    update("days", sortedDays);
  };

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-header">
          <span className="card-title">🎓 College configuration</span>
          <button className="btn btn-sm" onClick={loadDemo}>Load demo data</button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">College name</label>
            <input type="text" value={config.name} onChange={e=>update("name",e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Department / semester</label>
            <input type="text" value={config.dept} onChange={e=>update("dept",e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Lecture duration (min)</label>
            <select value={config.dur} onChange={e=>update("dur",+e.target.value)}>
              <option value={50}>50 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Lectures per day</label>
            <select value={config.perday} onChange={e=>update("perday",+e.target.value)}>
              {[4,5,6,7,8].map(n=><option key={n} value={n}>{n} lectures</option>)}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Day start time</label>
            <input type="time" value={config.start} onChange={e=>update("start",e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Break after lecture #</label>
            <select value={config.breakAfter} onChange={e=>update("breakAfter",+e.target.value)}>
              {[2,3,4].map(n=><option key={n} value={n}>After {n}{n===2?"nd":n===3?"rd":"th"}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: "1rem" }}>
          <label className="form-label">Working days</label>
          <div className="day-pills">
            {DAYS.map(d => (
              <button
                key={d}
                className={`day-pill ${config.days.includes(d) ? "active" : ""}`}
                onClick={() => toggleDay(d)}
              >
                {d.slice(0,3)}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={save}>
          {saved ? "✓ Saved" : "Save configuration"}
        </button>
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: "0.75rem" }}>📋 How it works</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.8 }}>
          <p style={{ marginBottom: 8 }}>
            This app generates clash-free timetables using a{" "}
            <strong style={{ color: "var(--accent)" }}>CSP Backtracking + Simulated Annealing</strong> hybrid:
          </p>
          {[
            ["1. CSP Backtracking", "Assigns every lecture to a slot with forward checking, guaranteeing zero teacher or room clashes before anything else happens."],
            ["2. Simulated Annealing", "Polishes that clash-free schedule by swapping lecture slots — accepting some worse moves early on to escape local optima — so labs land in lab rooms, subjects spread across the week, and back-to-back repeats are minimized."],
          ].map(([name,desc]) => (
            <div key={name} style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: "var(--purple)" }}>{name}</span>
              <span style={{ color: "var(--text3)" }}> — {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
