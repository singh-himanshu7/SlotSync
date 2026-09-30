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
  { bg: "rgba(56,189,248,0.18)", text: "#38bdf8", border: "rgba(56,189,248,0.4)" },
  { bg: "rgba(244,114,182,0.18)", text: "#f472b6", border: "rgba(244,114,182,0.4)" },
];

const orderedDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function getSections(subjects) {
  const list = [...new Set(subjects.map(s => s.section || "MCA 1st Sem"))];
  return list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

const pad = n => String(n).padStart(2, "0");
const fmt = mins => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

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

function buildSectionGrids(schedule, config, subjects, activeSections) {
  const days = [...config.days].sort((a, b) => orderedDays.indexOf(a) - orderedDays.indexOf(b));
  const targetSections = activeSections || getSections(subjects);

  return targetSections.map(sect => {
    const timeByIndex = {};
    const slotIndexesSet = new Set();
    Object.entries(schedule).forEach(([key, entry]) => {
      if (!entry) return;
      const parts = key.split("|");
      const entrySect = parts.length === 3 ? parts[0] : "MCA 1st Sem";
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
        const key = `${sect}|${d}|${si}`;
        return { day: d, entry: schedule[key] || null };
      });
      return { time, cells, si };
    });

    const { lunchTime, breakAfterIndex } = computeLunchInfo(config);
    const insertAt = rows.findIndex(r => r.si === breakAfterIndex);
    if (insertAt !== -1) {
      rows.splice(insertAt + 1, 0, { time: lunchTime || "Lunch", isLunch: true, cells: [] });
    }

    return { section: sect, days, rows };
  });
}

function exportPDF(schedule, config, subjects, teachers, rooms, activeSections) {
  const subMap = Object.fromEntries(subjects.map(s => [s.id, s]));
  const tcMap = Object.fromEntries(teachers.map(t => [t.id, t]));
  const rmMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  const grids = buildSectionGrids(schedule, config, subjects, activeSections);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  grids.forEach((grid, idx) => {
    if (idx > 0) doc.addPage();

    doc.setFontSize(16);
    doc.text(config.name || "Timetable", 40, 40);
    if (config.dept) {
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(config.dept, 40, 56);
      doc.setTextColor(0);
    }

    doc.setFontSize(13);
    doc.text(`${grid.section} — Conflict-Free Schedule`, 40, 75);

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
          const code = subj?.code ? ` (${subj.code})` : "";
          const teacherName = tc?.name || entry.teacher;
          const roomName = rm?.name || entry.room;
          return `${subjName}${code}\n${teacherName}\n${roomName}`;
        }),
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: 90,
      styles: { fontSize: 8, cellPadding: 5, valign: "middle", halign: "center", lineColor: [220, 220, 220] },
      headStyles: { fillColor: [79, 142, 247], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 75, fontStyle: "bold", halign: "left" } },
      theme: "grid",
    });
  });

  const filename = `${(config.name || "MCA_Timetable").replace(/\s+/g, "_")}.pdf`;
  doc.save(filename);
}

export default function TimetablePanel({
  subjects,
  teachers,
  rooms,
  config,
  timetable,
  mlHistory,
  generating,
  lastResult,
  selectedSemesters,
  setSelectedSemesters,
  generate
}) {
  const allSections = getSections(subjects);
  const [activeTabSection, setActiveTabSection] = useState("");
  const [showValidationDetails, setShowValidationDetails] = useState(false);

  // Determine sections present in the current timetable
  const timetableSections = timetable
    ? [...new Set(Object.keys(timetable).map(k => k.split("|")[0]))].filter(Boolean)
    : [];

  const availableDisplaySections = timetableSections.length > 0 ? timetableSections : allSections;
  const currentSection = availableDisplaySections.includes(activeTabSection)
    ? activeTabSection
    : (availableDisplaySections[0] || "MCA 1st Sem");

  const subMap = Object.fromEntries(subjects.map(s => [s.id, s]));
  const tcMap = Object.fromEntries(teachers.map(t => [t.id, t]));
  const rmMap = Object.fromEntries(rooms.map(r => [r.id, r]));

  // Build color map per subject
  const colorMap = {};
  subjects.forEach((s, i) => { colorMap[s.id] = SLOT_COLORS[i % SLOT_COLORS.length]; });

  // Group schedule by day -> slotIndex for currentSection
  const days = [...config.days].sort((a, b) => orderedDays.indexOf(a) - orderedDays.indexOf(b));
  const timeByIndex = {};
  const grid = {};
  days.forEach(d => { grid[d] = {}; });

  if (timetable) {
    Object.entries(timetable).forEach(([key, entry]) => {
      if (!entry) return;
      const parts = key.split("|");
      const sect = parts.length === 3 ? parts[0] : "MCA 1st Sem";
      const day = parts.length === 3 ? parts[1] : parts[0];
      const si = parts.length === 3 ? parts[2] : parts[1];

      if (sect === currentSection) {
        if (grid[day]) grid[day][+si] = entry;
      }
      timeByIndex[+entry.slotIndex] = entry.time;
    });
  }

  const slotIndexes = Array.from({ length: config.perday }, (_, i) => i);
  const { lunchTime, breakAfterIndex } = computeLunchInfo(config);

  const totalFilledSlots = timetable ? Object.values(timetable).filter(Boolean).length : 0;
  const totalSlotsCapacity = days.length * config.perday * (availableDisplaySections.length || 1);
  const overallUtilization = totalSlotsCapacity ? Math.round((totalFilledSlots / totalSlotsCapacity) * 100) : 0;

  // Toggle semester in selection
  const toggleSemester = (sec) => {
    if (selectedSemesters.length === 0) {
      // If currently "All", clicking one isolates all others
      const remaining = allSections.filter(s => s !== sec);
      setSelectedSemesters(remaining.length > 0 ? remaining : [sec]);
    } else if (selectedSemesters.includes(sec)) {
      const next = selectedSemesters.filter(s => s !== sec);
      setSelectedSemesters(next);
    } else {
      const next = [...selectedSemesters, sec];
      // If all are selected, set to empty (meaning All)
      if (next.length === allSections.length) {
        setSelectedSemesters([]);
      } else {
        setSelectedSemesters(next);
      }
    }
  };

  const selectAllSemesters = () => setSelectedSemesters([]);

  const isSemesterSelected = (sec) => {
    return selectedSemesters.length === 0 || selectedSemesters.includes(sec);
  };

  const validation = lastResult?.validation;

  return (
    <div>
      {/* Generation & Semester Control Card */}
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-title" style={{ marginBottom: "0.75rem" }}>
          🎯 Semester Selection & Generation Controls
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label className="form-label" style={{ marginBottom: 6, display: "block" }}>
            Select Semesters to Generate (MCA 1st, 2nd, 3rd, 4th, or Any Combination):
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className={`day-pill ${selectedSemesters.length === 0 ? "active" : ""}`}
              onClick={selectAllSemesters}
              style={{ fontWeight: 600 }}
            >
              🌟 All Semesters ({allSections.length})
            </button>
            {allSections.map(sec => {
              const active = isSemesterSelected(sec);
              const count = subjects.filter(s => s.section === sec).length;
              return (
                <button
                  key={sec}
                  type="button"
                  className={`day-pill ${active ? "active" : ""}`}
                  onClick={() => toggleSemester(sec)}
                >
                  {sec} <span style={{ opacity: 0.7, fontSize: 11 }}>({count} subjs)</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="algo-card selected" style={{ cursor: "default", marginBottom: 14 }}>
          <div className="algo-tag">🔐 Strict Zero-Conflict Architecture (11 Rules Enforced)</div>
          <div className="algo-name">CSP Forward-Checking + Simulated Annealing Multi-Semester Engine</div>
          <div className="algo-desc">
            Guarantees <strong>zero teacher double-booking</strong> across all MCA semesters simultaneously,
            <strong> zero consecutive lectures</strong> for the same teacher in the same semester, strict <strong>room availability</strong>,
            and exact <strong>LPW hours</strong> fulfillment.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn btn-primary"
            onClick={() => generate(selectedSemesters.length > 0 ? selectedSemesters : undefined)}
            disabled={generating || !subjects.length}
            style={{ minWidth: 200 }}
          >
            {generating ? <><span className="spinner"></span> Generating…</> : "⚡ Generate Timetable"}
          </button>

          {timetable && (
            <button
              className="btn btn-success"
              onClick={() => exportPDF(timetable, config, subjects, teachers, rooms, timetableSections)}
            >
              ⬇ Export Multi-Semester PDF
            </button>
          )}

          {selectedSemesters.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
              Targeting: <strong>{selectedSemesters.join(", ")}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Result Alerts */}
      {lastResult?.error && (
        <div className="alert alert-danger" style={{ marginBottom: "1rem" }}>
          {lastResult.error.startsWith("❌") ? lastResult.error : `❌ ${lastResult.error}`}
        </div>
      )}

      {lastResult && !lastResult.error && (
        <div
          className={`alert ${lastResult.clashFree ? "alert-success" : "alert-warning"}`}
          style={{ marginBottom: "1rem" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              {lastResult.clashFree
                ? `✅ Perfect conflict-free MCA timetable generated in ${lastResult.elapsed}s!`
                : `⚠️ Timetable generated with penalty score ${lastResult.penalty} (${lastResult.elapsed}s).`
              }
            </div>
            {validation && (
              <button
                type="button"
                onClick={() => setShowValidationDetails(!showValidationDetails)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                {showValidationDetails ? "Hide Audit Report ▲" : "View Constraint Audit Report ▼"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Post-Generation Constraint Verification Card */}
      {validation && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div
            className="card-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            onClick={() => setShowValidationDetails(!showValidationDetails)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="card-title">
                🛡️ Timetable Constraint Verification Report
              </span>
              <span className={`badge ${validation.isValid ? "badge-green" : "badge-red"}`}>
                {validation.isValid ? "100% Conflict-Free" : `${validation.totalViolations} Conflict(s)`}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--primary)" }}>
              {showValidationDetails ? "Collapse ▲" : "Details ▼"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 10 }}>
            {validation.checks?.map(c => (
              <div
                key={c.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: c.status === "pass" ? "rgba(52, 211, 153, 0.1)" : "rgba(248, 113, 113, 0.12)",
                  border: `1px solid ${c.status === "pass" ? "rgba(52, 211, 153, 0.3)" : "rgba(248, 113, 113, 0.4)"}`,
                  fontSize: 13
                }}
              >
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{c.status === "pass" ? "✅" : "❌"}</span>
                  <span style={{ color: c.status === "pass" ? "var(--success)" : "var(--danger)" }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
                  {c.status === "pass" ? "0 Violations (Passed)" : `${c.count} Violation(s) Detected`}
                </div>
              </div>
            ))}
          </div>

          {showValidationDetails && validation.conflicts?.length > 0 && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 6, background: "rgba(248, 113, 113, 0.08)", border: "1px solid rgba(248, 113, 113, 0.2)" }}>
              <div style={{ fontWeight: 600, color: "var(--danger)", fontSize: 13, marginBottom: 6 }}>
                Detailed Violations List:
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                {validation.conflicts.map((cnf, i) => (
                  <li key={i}>{cnf}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      {timetable && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{timetableSections.length || allSections.length}</div>
            <div className="stat-label">Active Semesters</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalFilledSlots}</div>
            <div className="stat-label">Total Lectures Scheduled</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--success)" }}>
              {validation?.isValid ? "0" : validation?.totalViolations || 0}
            </div>
            <div className="stat-label">Clashes / Clashing Slots</div>
          </div>
          <div className="stat-card">
            <div
              className="stat-value"
              style={{
                color: overallUtilization > 70 ? "var(--success)" : overallUtilization > 40 ? "var(--warning)" : "var(--danger)"
              }}
            >
              {overallUtilization}%
            </div>
            <div className="stat-label">Overall Slot Utilization</div>
          </div>
        </div>
      )}

      {/* Timetable Grid with Semester Tabs */}
      {timetable ? (
        <div className="card">
          <div
            className="card-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="card-title">📅 Master Timetable View</span>
              <span className="badge badge-blue">{currentSection}</span>
            </div>

            {/* Semester Tabs */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text3)", marginRight: 4 }}>Switch Semester:</span>
              {availableDisplaySections.map(sec => (
                <button
                  key={sec}
                  type="button"
                  className={`btn ${currentSection === sec ? "btn-primary" : ""}`}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    background: currentSection === sec ? undefined : "var(--bg3)",
                    border: "1px solid var(--border)"
                  }}
                  onClick={() => setActiveTabSection(sec)}
                >
                  {sec}
                </button>
              ))}
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
                              <div className="tt-slot-code" style={{ color: col.text }}>
                                {subj?.name || cell.subject} {subj?.code ? `(${subj.code})` : ""}
                              </div>
                              <div className="tt-slot-teacher">
                                👨‍🏫 {tc?.name || "—"}
                              </div>
                              <div className="tt-slot-room">
                                📍 {rm?.name || cell.room}
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {si === breakAfterIndex && (
                      <tr key={`lunch-${si}`}>
                        <td className="tt-time">{lunchTime || "Lunch"}</td>
                        <td colSpan={days.length}>
                          <div
                            className="tt-slot"
                            style={{
                              background: "rgba(251,191,36,0.15)",
                              border: "1px solid rgba(251,191,36,0.4)",
                              alignItems: "center"
                            }}
                          >
                            <div className="tt-slot-code" style={{ color: "var(--warning)", textAlign: "center", width: "100%" }}>
                              🍽️ Lunch Break
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Subject Legend for active section */}
          <div className="legend">
            {subjects
              .filter(s => s.section === currentSection)
              .map((s, i) => {
                const col = colorMap[s.id] || SLOT_COLORS[i % SLOT_COLORS.length];
                const tc = teachers.find(t => t.subjects?.includes(s.id));
                return (
                  <div key={s.id} className="legend-item">
                    <div className="legend-dot" style={{ background: col.text }}></div>
                    <span>
                      <strong>{s.name}</strong> {s.code ? `(${s.code})` : ""} — {tc?.name || "No Teacher"} ({s.lpw}h/wk)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      ) : !generating && (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">🗓️</div>
            <div>Select semesters above and click <strong>"⚡ Generate Timetable"</strong> to construct the multi-semester schedule.</div>
          </div>
        </div>
      )}

      {/* Optimization convergence chart */}
      {mlHistory?.length > 0 && <MLChart history={mlHistory} />}
    </div>
  );
}
