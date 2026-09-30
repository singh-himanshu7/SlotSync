import { useState } from "react";

function Modal({ title, children, onSave, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {children}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Subject Form ────────────────────────────────────
function SubjectForm({ initial, onChange }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    name: initial?.name || "",
    code: initial?.code || "",
    lpw: initial?.lpw || 3,
    stype: initial?.stype || "theory",
    section: initial?.section || "Sem 5"
  }));
  const u = (k, v) => { const n = { ...form, [k]: v }; setForm(n); onChange(n); };
  return (
    <div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="form-group">
          <label className="form-label">Subject name</label>
          <input type="text" value={form.name} onChange={e => u("name", e.target.value)} placeholder="e.g. Data Structures" />
        </div>
        <div className="form-group">
          <label className="form-label">Code</label>
          <input type="text" value={form.code} onChange={e => u("code", e.target.value)} placeholder="e.g. CS301" />
        </div>
        <div className="form-group">
          <label className="form-label">Section / Sem</label>
          <input type="text" value={form.section} onChange={e => u("section", e.target.value)} placeholder="e.g. Sem 5" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Lectures / week</label>
          <select value={form.lpw} onChange={e => u("lpw", +e.target.value)}>
            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select value={form.stype} onChange={e => u("stype", e.target.value)}>
            <option value="theory">Theory</option>
            <option value="lab">Lab</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Teacher Form ────────────────────────────────────
function TeacherForm({ initial, subjects, onChange }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    name: initial?.name || "",
    dept: initial?.dept || "",
    subjects: initial?.subjects || []
  }));
  const u = (k, v) => { const n = { ...form, [k]: v }; setForm(n); onChange(n); };
  const toggleSubj = (id) => {
    const subs = (form.subjects || []).includes(id) ? (form.subjects || []).filter(x => x !== id) : [...(form.subjects || []), id];
    u("subjects", subs);
  };
  return (
    <div>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <div className="form-group">
          <label className="form-label">Teacher name</label>
          <input type="text" value={form.name} onChange={e => u("name", e.target.value)} placeholder="e.g. Dr. Sharma" />
        </div>
        <div className="form-group">
          <label className="form-label">Department</label>
          <input type="text" value={form.dept} onChange={e => u("dept", e.target.value)} placeholder="e.g. CSE" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Can teach</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {subjects.length === 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>Add subjects first</span>}
          {subjects.map(s => {
            const label = s.code ? `${s.name} (${s.code})` : s.name;
            const sec = s.section ? ` [${s.section}]` : "";
            return (
              <button
                key={s.id}
                type="button"
                className={`day-pill ${form.subjects.includes(s.id) ? "active" : ""}`}
                onClick={() => toggleSubj(s.id)}
              >
                {label}{sec}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Room Form ───────────────────────────────────────
function RoomForm({ initial, onChange }) {
  const [form, setForm] = useState(() => ({
    id: initial?.id,
    name: initial?.name || "",
    cap: initial?.cap || 60,
    rtype: initial?.rtype || "classroom"
  }));
  const u = (k, v) => { const n = { ...form, [k]: v }; setForm(n); onChange(n); };
  return (
    <div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label className="form-label">Room name / number</label>
        <input type="text" value={form.name} onChange={e => u("name", e.target.value)} placeholder="e.g. Room 101" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Capacity</label>
          <input type="number" value={form.cap} min={1} onChange={e => u("cap", +e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select value={form.rtype} onChange={e => u("rtype", e.target.value)}>
            <option value="classroom">Classroom</option>
            <option value="lab">Lab</option>
            <option value="seminar">Seminar hall</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Generic CRUD panel ──────────────────────────────
export default function CRUDPanel({ type, items, onAdd, onUpdate, onDelete, subjects }) {
  const [modal, setModal] = useState(null); // null | {mode:"add"|"edit", item:...}
  const [formData, setFormData] = useState({});

  const openAdd = () => { setFormData({}); setModal({ mode: "add" }); };
  const openEdit = (item) => { setFormData({ ...item }); setModal({ mode: "edit", item }); };

  const save = () => {
    if (!formData.name) return;
    if (modal.mode === "add") onAdd(formData);
    else onUpdate(formData);
    setModal(null);
  };

  const labels = { subject: "Subject", teacher: "Teacher", room: "Room" };
  const icons = { subject: "📚", teacher: "👨‍🏫", room: "🏛️" };

  const typeBadge = (item) => {
    if (type === "subject") return (
      <>
        <span className={`badge ${item.stype === "lab" ? "badge-amber" : "badge-blue"}`}>{item.stype}</span>
        <span className="badge badge-green" style={{ marginLeft: 6 }}>{item.section || "Sem 5"}</span>
      </>
    );
    if (type === "room") return <span className={`badge ${item.rtype === "lab" ? "badge-amber" : item.rtype === "seminar" ? "badge-green" : "badge-blue"}`}>{item.rtype}</span>;
    return null;
  };

  const metaLine = (item) => {
    if (type === "subject") return `${item.lpw} lectures/week`;
    if (type === "teacher") return item.subjects.map(sid => subjects?.find(s => s.id === sid)?.code || "?").join(", ") || "—";
    if (type === "room") return `Capacity: ${item.cap}`;
    return "";
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <span className="card-title">{icons[type]} {labels[type]}s</span>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add {labels[type]}</button>
        </div>

        {items.length === 0
          ? <div className="empty"><div className="empty-icon">📭</div>No {labels[type].toLowerCase()}s yet. Add one above.</div>
          : (
            <div className="item-list">
              {items.map(item => (
                <div className="item-card" key={item.id}>
                  <div>
                    <div className="item-name">
                      {item.name}
                      {item.code && <span style={{ color: "var(--text3)", fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{item.code}</span>}
                    </div>
                    <div className="item-meta" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                      <span>{metaLine(item)}</span>
                      {typeBadge(item)}
                    </div>
                  </div>
                  <div className="item-actions">
                    <button className="btn btn-sm" onClick={() => openEdit(item)} title="Edit">✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(item.id)} title="Delete">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      {modal && (
        <Modal
          title={`${modal.mode === "add" ? "Add" : "Edit"} ${labels[type]}`}
          onSave={save}
          onClose={() => setModal(null)}
        >
          {type === "subject" && <SubjectForm initial={formData} onChange={setFormData} />}
          {type === "teacher" && <TeacherForm initial={formData} subjects={subjects || []} onChange={setFormData} />}
          {type === "room" && <RoomForm initial={formData} onChange={setFormData} />}
        </Modal>
      )}
    </div>
  );
}
