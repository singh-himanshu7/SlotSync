import { useState, useCallback, useEffect } from "react";

const uid = () => Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = "timetableai_state_v2";

/** Read once at hook init. Guarded so it never throws */
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
    // MCA 1st Semester
    { id: "s101", name: "Python Programming", code: "MCA101", lpw: 3, stype: "theory", section: "MCA 1st Sem" },
    { id: "s102", name: "Data Structures & Algorithms", code: "MCA102", lpw: 3, stype: "theory", section: "MCA 1st Sem" },
    { id: "s103", name: "Computer Organization & Arch.", code: "MCA103", lpw: 3, stype: "theory", section: "MCA 1st Sem" },
    { id: "s104", name: "Discrete Mathematics", code: "MCA104", lpw: 3, stype: "theory", section: "MCA 1st Sem" },
    { id: "s105", name: "Python & DSA Lab", code: "MCA105", lpw: 2, stype: "lab", section: "MCA 1st Sem" },

    // MCA 2nd Semester
    { id: "s201", name: "Advanced Java Programming", code: "MCA201", lpw: 3, stype: "theory", section: "MCA 2nd Sem" },
    { id: "s202", name: "Database Management Systems", code: "MCA202", lpw: 3, stype: "theory", section: "MCA 2nd Sem" },
    { id: "s203", name: "Operating Systems & Linux", code: "MCA203", lpw: 3, stype: "theory", section: "MCA 2nd Sem" },
    { id: "s204", name: "Software Engineering", code: "MCA204", lpw: 2, stype: "theory", section: "MCA 2nd Sem" },
    { id: "s205", name: "Java & DBMS Lab", code: "MCA205", lpw: 2, stype: "lab", section: "MCA 2nd Sem" },

    // MCA 3rd Semester
    { id: "s301", name: "Web Technologies & Frameworks", code: "MCA301", lpw: 3, stype: "theory", section: "MCA 3rd Sem" },
    { id: "s302", name: "Artificial Intelligence & ML", code: "MCA302", lpw: 3, stype: "theory", section: "MCA 3rd Sem" },
    { id: "s303", name: "Cloud Computing & DevOps", code: "MCA303", lpw: 3, stype: "theory", section: "MCA 3rd Sem" },
    { id: "s304", name: "Cyber Security & Cryptography", code: "MCA304", lpw: 2, stype: "theory", section: "MCA 3rd Sem" },
    { id: "s305", name: "Full Stack & AI Lab", code: "MCA305", lpw: 2, stype: "lab", section: "MCA 3rd Sem" },

    // MCA 4th Semester
    { id: "s401", name: "Big Data Analytics", code: "MCA401", lpw: 3, stype: "theory", section: "MCA 4th Sem" },
    { id: "s402", name: "Deep Learning & NLP", code: "MCA402", lpw: 3, stype: "theory", section: "MCA 4th Sem" },
    { id: "s403", name: "Mobile Application Dev", code: "MCA403", lpw: 3, stype: "theory", section: "MCA 4th Sem" },
    { id: "s404", name: "Major Project & Seminar", code: "MCA404", lpw: 2, stype: "theory", section: "MCA 4th Sem" },
    { id: "s405", name: "Advanced Computing Lab", code: "MCA405", lpw: 2, stype: "lab", section: "MCA 4th Sem" },
  ],
  teachers: [
    { id: "t1", name: "Dr. Arvind Kumar", dept: "MCA", subjects: ["s101", "s105", "s302", "s305"] },
    { id: "t2", name: "Prof. Sunita Sharma", dept: "MCA", subjects: ["s102", "s201", "s205", "s403"] },
    { id: "t3", name: "Dr. Rajesh Verma", dept: "MCA", subjects: ["s103", "s202", "s205", "s401"] },
    { id: "t4", name: "Prof. Neha Gupta", dept: "MCA", subjects: ["s104", "s204", "s304"] },
    { id: "t5", name: "Dr. Manish Patel", dept: "MCA", subjects: ["s203", "s301", "s305", "s402"] },
    { id: "t6", name: "Prof. Priya Singh", dept: "MCA", subjects: ["s303", "s404", "s405"] },
  ],
  rooms: [
    { id: "r1", name: "LH-101 (MCA 1st)", cap: 60, rtype: "classroom" },
    { id: "r2", name: "LH-102 (MCA 2nd)", cap: 60, rtype: "classroom" },
    { id: "r3", name: "LH-201 (MCA 3rd)", cap: 60, rtype: "classroom" },
    { id: "r4", name: "LH-202 (MCA 4th)", cap: 60, rtype: "classroom" },
    { id: "r5", name: "MCA Advanced Lab 1", cap: 35, rtype: "lab" },
    { id: "r6", name: "MCA AI & Cloud Lab 2", cap: 35, rtype: "lab" },
    { id: "r7", name: "MCA Seminar Hall", cap: 120, rtype: "seminar" },
  ],
};

const DEFAULT_CONFIG = {
  name: "Department of Master of Computer Applications (MCA)",
  dept: "MCA Department — Timetable Management",
  dur: 60,
  perday: 6,
  start: "09:00",
  breakAfter: 3,
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
};

export default function useStore() {
  const [persisted] = useState(readPersisted);

  const [config, setConfig] = useState(persisted.config || DEFAULT_CONFIG);
  const [subjects, setSubjects] = useState(persisted.subjects || DEMO_DATA.subjects);
  const [teachers, setTeachers] = useState(persisted.teachers || DEMO_DATA.teachers);
  const [rooms, setRooms] = useState(persisted.rooms || DEMO_DATA.rooms);
  const [timetable, setTimetable] = useState(persisted.timetable ?? null);
  const [mlHistory, setMlHistory] = useState(persisted.mlHistory || []);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState(persisted.lastResult || null);
  const [selectedSemesters, setSelectedSemesters] = useState(persisted.selectedSemesters || []);

  // Persist on every change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        config, subjects, teachers, rooms, timetable, mlHistory, lastResult, selectedSemesters,
      }));
    } catch {
      // storage full/unavailable — fail silently
    }
  }, [config, subjects, teachers, rooms, timetable, mlHistory, lastResult, selectedSemesters]);

  const loadDemo = useCallback(() => {
    setSubjects(DEMO_DATA.subjects);
    setTeachers(DEMO_DATA.teachers);
    setRooms(DEMO_DATA.rooms);
    setConfig(DEFAULT_CONFIG);
    setTimetable(null);
    setMlHistory([]);
    setLastResult(null);
    setSelectedSemesters([]);
  }, []);

  const resetAll = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    setSubjects([]);
    setTeachers([]);
    setRooms([]);
    setTimetable(null);
    setMlHistory([]);
    setLastResult(null);
    setSelectedSemesters([]);
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, []);

  // ─── CRUD helpers ───────────────────────────────────
  const addSubject = (s) => setSubjects(p => [...p, { section: "MCA 1st Sem", ...s, id: uid() }]);
  const updateSubject = (s) => setSubjects(p => p.map(x => x.id === s.id ? s : x));
  const deleteSubject = (id) => setSubjects(p => p.filter(x => x.id !== id));

  const addTeacher = (t) => setTeachers(p => [...p, { ...t, id: uid() }]);
  const updateTeacher = (t) => setTeachers(p => p.map(x => x.id === t.id ? t : x));
  const deleteTeacher = (id) => setTeachers(p => p.filter(x => x.id !== id));

  const addRoom = (r) => setRooms(p => [...p, { ...r, id: uid() }]);
  const updateRoom = (r) => setRooms(p => p.map(x => x.id === r.id ? r : x));
  const deleteRoom = (id) => setRooms(p => p.filter(x => x.id !== id));

  // ─── Generate via backend API ────────────────────────
  const generate = useCallback(async (semestersToGenerate) => {
    setGenerating(true);
    setTimetable(null);
    setMlHistory([]);
    setLastResult(null);
    try {
      const semList = semestersToGenerate !== undefined ? semestersToGenerate : selectedSemesters;
      const res = await fetch("http://localhost:5000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: { subjects, teachers, rooms },
          config,
          selectedSemesters: semList && semList.length > 0 ? semList : undefined,
        }),
      });
      let json;
      try {
        json = await res.json();
      } catch {
        json = { error: `Server error (${res.status} ${res.statusText})` };
      }
      if (!res.ok || json.error) {
        throw new Error(json.error || `Generation failed (${res.status})`);
      }
      setTimetable(json.schedule);
      setMlHistory(json.history || []);
      setLastResult(json);
    } catch (e) {
      const isNetworkErr = e.name === "TypeError" || e.message?.includes("Failed to fetch");
      setLastResult({
        error: isNetworkErr
          ? "Unable to connect to backend server. Please make sure Flask is running on port 5000."
          : e.message
      });
    } finally {
      setGenerating(false);
    }
  }, [subjects, teachers, rooms, config, selectedSemesters]);

  return {
    config, setConfig,
    subjects, addSubject, updateSubject, deleteSubject,
    teachers, addTeacher, updateTeacher, deleteTeacher,
    rooms, addRoom, updateRoom, deleteRoom,
    timetable, mlHistory, generating, lastResult,
    selectedSemesters, setSelectedSemesters,
    generate, loadDemo, resetAll,
  };
}
