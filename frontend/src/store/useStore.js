import { useState, useCallback, useEffect } from "react";

const uid = () => Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = "timetableai_state_v1";

/** Read once at hook init. Guarded so it never throws (private-browsing
 *  mode, storage disabled, corrupted JSON, etc. all just fall back to
 *  empty and the app behaves like a fresh install). */
function readPersisted() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const DEMO_DATA = {
  subjects: [
    { id: "s1", name: "Data Structures", code: "CS301", lpw: 3, stype: "theory", section: "Sem 5" },
    { id: "s2", name: "Operating Systems", code: "CS302", lpw: 3, stype: "theory", section: "Sem 5" },
    { id: "s3", name: "Database Systems", code: "CS303", lpw: 3, stype: "theory", section: "Sem 5" },
    { id: "s4", name: "Computer Networks", code: "CS304", lpw: 2, stype: "theory", section: "Sem 5" },
    { id: "s5", name: "DS Lab", code: "CS305", lpw: 2, stype: "lab", section: "Sem 5" },
    { id: "s6", name: "DBMS Lab", code: "CS306", lpw: 1, stype: "lab", section: "Sem 5" },
    { id: "s7", name: "Discrete Math", code: "CS201", lpw: 3, stype: "theory", section: "Sem 3" },
    { id: "s8", name: "OOP in Java", code: "CS202", lpw: 3, stype: "theory", section: "Sem 3" },
    { id: "s9", name: "OOP Lab", code: "CS203", lpw: 2, stype: "lab", section: "Sem 3" },
  ],
  teachers: [
    { id: "t1", name: "Dr. R. Sharma", dept: "CSE", subjects: ["s1", "s5", "s8", "s9"] },
    { id: "t2", name: "Prof. M. Gupta", dept: "CSE", subjects: ["s2", "s7"] },
    { id: "t3", name: "Dr. P. Joshi", dept: "CSE", subjects: ["s3", "s6"] },
    { id: "t4", name: "Dr. K. Verma", dept: "CSE", subjects: ["s4"] },
  ],
  rooms: [
    { id: "r1", name: "Room 101", cap: 60, rtype: "classroom" },
    { id: "r2", name: "Room 202", cap: 60, rtype: "classroom" },
    { id: "r3", name: "CS Lab A", cap: 30, rtype: "lab" },
    { id: "r4", name: "Seminar Hall", cap: 100, rtype: "seminar" },
  ],
};

const DEFAULT_CONFIG = {
  name: "Sunrise Engineering College",
  dept: "Computer Science — Sem 5",
  dur: 60,
  perday: 6,
  start: "09:00",
  breakAfter: 3,
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
};

export default function useStore() {
  // Read localStorage exactly once (lazy initializer), then every piece
  // of state below falls back to it before falling back to hardcoded defaults.
  const [persisted] = useState(readPersisted);

  const [config, setConfig] = useState(persisted.config || DEFAULT_CONFIG);
  const [subjects, setSubjects] = useState(persisted.subjects || []);
  const [teachers, setTeachers] = useState(persisted.teachers || []);
  const [rooms, setRooms] = useState(persisted.rooms || []);
  const [timetable, setTimetable] = useState(persisted.timetable ?? null);
  const [mlHistory, setMlHistory] = useState(persisted.mlHistory || []);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState(persisted.lastResult || null);

  // Persist on every change. Cheap for this data size, so no debouncing needed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        config, subjects, teachers, rooms, timetable, mlHistory, lastResult,
      }));
    } catch {
      // storage full/unavailable — fail silently rather than crash the app
    }
  }, [config, subjects, teachers, rooms, timetable, mlHistory, lastResult]);

  const loadDemo = useCallback(() => {
    setSubjects(DEMO_DATA.subjects);
    setTeachers(DEMO_DATA.teachers);
    setRooms(DEMO_DATA.rooms);
  }, []);

  const resetAll = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    setSubjects([]);
    setTeachers([]);
    setRooms([]);
    setTimetable(null);
    setMlHistory([]);
    setLastResult(null);
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, []);

  // ─── CRUD helpers ───────────────────────────────────
  const addSubject = (s) => setSubjects(p => [...p, { section: "Sem 5", ...s, id: uid() }]);
  const updateSubject = (s) => setSubjects(p => p.map(x => x.id === s.id ? s : x));
  const deleteSubject = (id) => setSubjects(p => p.filter(x => x.id !== id));

  const addTeacher = (t) => setTeachers(p => [...p, { ...t, id: uid() }]);
  const updateTeacher = (t) => setTeachers(p => p.map(x => x.id === t.id ? t : x));
  const deleteTeacher = (id) => setTeachers(p => p.filter(x => x.id !== id));

  const addRoom = (r) => setRooms(p => [...p, { ...r, id: uid() }]);
  const updateRoom = (r) => setRooms(p => p.map(x => x.id === r.id ? r : x));
  const deleteRoom = (id) => setRooms(p => p.filter(x => x.id !== id));

  // ─── Generate via backend API ────────────────────────
  const generate = useCallback(async () => {
    setGenerating(true);
    setTimetable(null);
    setMlHistory([]);
    setLastResult(null);
    try {
      const res = await fetch("http://localhost:5000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { subjects, teachers, rooms }, config }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTimetable(json.schedule);
      setMlHistory(json.history || []);
      setLastResult(json);
    } catch (e) {
      setLastResult({ error: e.message });
    } finally {
      setGenerating(false);
    }
  }, [subjects, teachers, rooms, config]);

  return {
    config, setConfig,
    subjects, addSubject, updateSubject, deleteSubject,
    teachers, addTeacher, updateTeacher, deleteTeacher,
    rooms, addRoom, updateRoom, deleteRoom,
    timetable, mlHistory, generating, lastResult,
    generate, loadDemo, resetAll,
  };
}
