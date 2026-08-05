import { useState, Fragment } from "react";
import MLChart from "./MLChart";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const SLOT_COLORS = [
  { bg: "rgba(79,142,247,0.18)", text: "#7eb3ff", border: "rgba(79,142,247,0.4)" },
  { bg: "rgba(52,211,153,0.18)", text: "#34d399", border: "rgba(52,211,153,0.4)" },
  { bg: "rgba(251,191,36,0.18)", text: "#fbbf24", border: "rgba(251,191,36,0.4)" },
  { bg: "rgba(167,139,250,0.18)", text: "#a78bfa", border: "rgba(167,139,250,0.4)" },
  { bg: "rgba(248,113,113,0.18)", text: "#f87171", border: "rgba(248,113,113,0.4)" },
  { bg: "rgba(45,212,191,0.18)", text: "#2dd4bf", border: "rgba(45,212,191,0.4)" },
  { bg: "rgba(251,146,60,0.18)", text: "#fb923c", border: "rgba(251,146,60,0.4)" },
  { bg: "rgba(232,121,249,0.18)", text: "#e879f9", border: "rgba(232,121,249,0.4)" },
];

const orderedDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function getSections(subjects) {
  return [...new Set(subjects.map(s => s.section || "Sem 5"))].sort();
}

const pad = n => String(n).padStart(2, "0");
const fmt = mins => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** Mirrors the backend's slot_times(): walks through each period adding
 *  `dur` minutes, and inserts a 20-min gap after the `breakAfter`-th
 *  period. Returns the lunch break's own time range and which period
 *  index it falls after, so the UI can render an actual row for it. */
function computeLunchInfo(config) {
  const breakAfter = config.breakAfter || 3;
  if (!config.start || !config.dur) return { lunchTime: null, breakAfterIndex: breakAfter - 1 };
  const [h, m] = config.start.split(":").map(Number);
  let cur = h * 60 + m;
  let lunchTime = null;
  for (let i = 0; i < config.perday; i++) {
    cur += config.dur;
    if (i + 1 === breakAfter) {
      const start = cur;
      cur += 20;
      lunchTime = `${fmt(start)}–${fmt(cur)}`;
      break;
    }
  }
  return { lunchTime, breakAfterIndex: breakAfter - 1 };
}

/** Build a { section -> { slotIndex -> time, days: [...], rows: [{time, cells:[{day, entry}]}] } } structure
 *  shared by both the on-screen grid and the PDF export, so they always match. */
function buildSectionGrids(schedule, config, subjects) {
  const days = [...config.days].sort((a, b) => orderedDays.indexOf(a) - orderedDays.indexOf(b));
  const sections = getSections(subjects);

  return sections.map(sect => {
    const timeByIndex = {};
    const slotIndexesSet = new Set();
    Object.entries(schedule).forEach(([key, entry]) => {
      if (!entry) return;
      const parts = key.split("|");
      const entrySect = parts.length === 3 ? parts[0] : "Sem 5";
      if (entrySect === sect) {
        timeByIndex[entry.slotIndex] = entry.time;
        slotIndexesSet.add(entry.slotIndex);
      }
    });
    const slotIndexes = slotIndexesSet.size > 0
      ? [...slotIndexesSet].sort((a, b) => a - b)
      : Array.from({ length: config.perday }, (_, i) => i);

    const rows = slotIndexes.map(si => {
      const time = timeByIndex[si] || `Slot ${si + 1}`;
      const cells = days.map(d => {
        const key = schedule[`${sect}|${d}|${si}`] ? `${sect}|${d}|${si}` : `${d}|${si}`;
        return { day: d, entry: schedule[key] || null };
      });
      return { time, cells, si };
    });

    // Splice in the lunch break row right after its period, if it falls
    // within the rendered slots.
    const { lunchTime, breakAfterIndex } = computeLunchInfo(config);
    const insertAt = rows.findIndex(r => r.si === breakAfterIndex);
    if (insertAt !== -1) {
      rows.splice(insertAt + 1, 0, { time: lunchTime || "Lunch", isLunch: true, cells: [] });
    }

    return { section: sect, days, rows };
  });
}

function exportPDF(schedule, config, subjects, teachers, rooms) {
  const subMap = Object.fromEntries(subjects.map(s => [s.id, s]));
  const tcMap = Object.fromEntries(teachers.map(t => [t.id, t]));
  const rmMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  const grids = buildSectionGrids(schedule, config, subjects);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(16);
  doc.text(config.name || "Timetable", 40, 40);
  if (config.dept) {
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(config.dept, 40, 56);
    doc.setTextColor(0);
  }

  let startY = 75;

  grids.forEach((grid, idx) => {
    if (idx > 0) {
      doc.addPage();
      startY = 40;
      doc.setFontSize(16);
      doc.text(config.name || "Timetable", 40, 40);
      startY = 60;
    }

    doc.setFontSize(12);
    doc.text(`${grid.section} Timetable`, 40, startY);

    const head = [["Time", ...grid.days]];
    const body = grid.rows.map(row => {
      if (row.isLunch) {
        return [
          row.time,
          { content: "LUNCH BREAK", colSpan: grid.days.length, styles: { halign: "center", fontStyle: "bold", fillColor: [253, 230, 138] } },
        ];
      }
      return [
        row.time,
        ...row.cells.map(({ entry }) => {
          if (!entry) return "";
          const subj = subMap[entry.subject];
          const tc = tcMap[entry.teacher];
          const rm = rmMap[entry.room];
          const subjName = subj?.name || entry.subject;
          const teacherName = tc?.name || entry.teacher;
          const roomName = rm?.name || entry.room;
          return `${subjName}\n${teacherName}\n${roomName}`;
        }),
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: startY + 12,
      styles: { fontSize: 8, cellPadding: 5, valign: "middle", halign: "center", lineColor: [220, 220, 220] },
      headStyles: { fillColor: [79, 142, 247], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 70, fontStyle: "bold", halign: "left" } },
      theme: "grid",
    });
  });

  const filename = `${(config.name || "timetable").replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
}

export default function TimetablePanel({ subjects, teachers, rooms, config, timetable, mlHistory, generating, lastResult, generate }) {
  const sections = getSections(subjects);
  const [selectedSection, setSelectedSection] = useState("Sem 5");
  const activeSection = sections.includes(selectedSection) ? selectedSection : (sections[0] || "Sem 5");

  const subMap = Object.fromEntries(subjects.map(s => [s.id, s]));
  const tcMap = Object.fromEntries(teachers.map(t => [t.id, t]));
  const rmMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  // Build color map per subject id
  const colorMap = {};
  subjects.forEach((s, i) => { colorMap[s.id] = SLOT_COLORS[i % SLOT_COLORS.length]; });

  // Group schedule by day→slotIndex
  const days = [...config.days].sort((a, b) => orderedDays.indexOf(a) - orderedDays.indexOf(b));
  const timeByIndex = {};
  const grid = {};
  days.forEach(d => { grid[d] = {}; });

  if (timetable) {
    Object.entries(timetable).forEach(([key, entry]) => {
      if (!entry) return;
      const parts = key.split("|");
      let sect, day, si;
      if (parts.length === 3) {
        [sect, day, si] = parts;
      } else {
        sect = "Sem 5";
        [day, si] = parts;
      }
      if (sect === activeSection) {
        if (grid[day]) grid[day][+si] = entry;
      }
      timeByIndex[+entry.slotIndex] = entry.time;
    });
  }

  const slotIndexes = Array.from({ length: config.perday }, (_, i) => i);
  const { lunchTime, breakAfterIndex } = computeLunchInfo(config);

  const filledCount = timetable ? Object.values(timetable).filter(Boolean).length : 0;
  const totalSlots = days.length * config.perday;
  const utilization = totalSlots ? Math.round(filledCount / totalSlots * 100) : 0;

  return (
    <div>
      {/* Algorithm info */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-title" style={{ marginBottom: "0.75rem" }}>🧠 Scheduling algorithm</div>
        <div className="algo-card selected" style={{ cursor: "default", marginBottom: 14 }}>
          <div className="algo-tag">🔐🌡️ Hybrid — Constraint-based + Probabilistic</div>
          <div className="algo-name">CSP Backtracking + Simulated Annealing</div>
          <div className="algo-desc">
            First finds a schedule with <strong>zero teacher/room clashes</strong> using constraint
            satisfaction with backtracking, then polishes it with simulated annealing to also satisfy
            soft preferences (labs in lab rooms, subjects spread across the week, no back-to-back
            repeats) — without ever reintroducing a clash.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button className="btn btn-primary" onClick={() => generate()} disabled={generating || !subjects.length}>
            {generating ? <><span className="spinner"></span> Generating…</> : "⚡ Generate timetable"}
          </button>
          {timetable && (
            <button className="btn btn-success" onClick={() => exportPDF(timetable, config, subjects, teachers, rooms)}>
              ⬇ Export PDF
            </button>
          )}
        </div>
      </div>

      {/* Result alerts */}
      {lastResult?.error && (
        <div className="alert alert-danger">❌ {lastResult.error} — make sure the backend is running on port 5000.</div>
      )}
      {lastResult && !lastResult.error && (
        <div className={`alert ${lastResult.clashFree ? "alert-success" : "alert-warning"}`}>
          {lastResult.clashFree
            ? `✅ Clash-free schedule generated in ${lastResult.elapsed}s.`
            : `⚠️ Schedule generated with penalty score ${lastResult.penalty} — some soft constraints couldn't be fully satisfied.`
          }
        </div>
      )}

      {/* Stats */}
      {timetable && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{subjects.length}</div><div className="stat-label">Subjects</div></div>
          <div className="stat-card"><div className="stat-value">{teachers.length}</div><div className="stat-label">Teachers</div></div>
          <div className="stat-card"><div className="stat-value">{filledCount}</div><div className="stat-label">Slots filled</div></div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: utilization > 70 ? "var(--success)" : utilization > 40 ? "var(--warning)" : "var(--danger)" }}>
              {utilization}%
            </div>
            <div className="stat-label">Utilization</div>
          </div>
        </div>
      )}

      {/* Timetable grid */}
      {timetable ? (
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="card-title">📅 Weekly Timetable — {activeSection}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>Section:</span>
              <select
                value={activeSection}
                onChange={e => setSelectedSection(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: "var(--bg3)",
                  color: "var(--text1)",
                  border: "1px solid var(--border)",
                  fontSize: 13
                }}
              >
                {sections.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="badge badge-blue">{config.name}</span>
            </div>
          </div>
          <div className="tt-wrap">
            <table className="tt-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 90 }}>Time</th>
                  {days.map(d => <th key={d}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {slotIndexes.map(si => (
                  <Fragment key={si}>
                    <tr>
                      <td className="tt-time">{timeByIndex[si] || `Slot ${si + 1}`}</td>
                      {days.map(d => {
                        const cell = grid[d]?.[si];
                        if (!cell) return <td key={d}></td>;
                        const subj = subMap[cell.subject];
                        const tc = tcMap[cell.teacher];
                        const rm = rmMap[cell.room];
                        const col = colorMap[cell.subject] || SLOT_COLORS[0];
                        return (
                          <td key={d}>
                            <div className="tt-slot" style={{ background: col.bg, border: `1px solid ${col.border}` }}>
                              <div className="tt-slot-code" style={{ color: col.text }}>{subj?.name || cell.subject}</div>
                              <div className="tt-slot-teacher">{tc?.name?.split(" ").slice(-1)[0] || "—"}</div>
                              <div className="tt-slot-room">{rm?.name || cell.room}</div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {si === breakAfterIndex && (
                      <tr key={`lunch-${si}`}>
                        <td className="tt-time">{lunchTime || "Lunch"}</td>
                        <td colSpan={days.length}>
                          <div className="tt-slot" style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", alignItems: "center" }}>
                            <div className="tt-slot-code" style={{ color: "var(--warning)", textAlign: "center", width: "100%" }}>🍽️ Lunch Break</div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="legend">
            {subjects.map((s, i) => {
              const col = SLOT_COLORS[i % SLOT_COLORS.length];
              return (
                <div key={s.id} className="legend-item">
                  <div className="legend-dot" style={{ background: col.text }}></div>
                  {s.name}{s.code ? ` (${s.code})` : ""}
                </div>
              );
            })}
          </div>
        </div>
      ) : !generating && (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">🗓️</div>
            Configure subjects, teachers and rooms, then click "Generate timetable".
          </div>
        </div>
      )}

      {/* Optimization convergence chart */}
      {mlHistory?.length > 0 && <MLChart history={mlHistory} />}
    </div>
  );
}
