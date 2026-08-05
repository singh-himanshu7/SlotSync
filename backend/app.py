"""
College Timetable Generator — Flask Backend

Algorithm: CSP Backtracking + Simulated Annealing hybrid.

  Phase 1 (feasibility)  — Constraint Satisfaction via backtracking with
                            forward checking finds a schedule with zero
                            teacher/room clashes (the hard constraints).
  Phase 2 (optimization) — Simulated Annealing then polishes that schedule,
                            swapping lecture slots to minimize soft-constraint
                            penalties (lab/room mismatches, back-to-back
                            repeats, poor day-spread). SA can accept a
                            temporarily worse swap while "hot", which lets it
                            escape local optima that plain hill-climbing gets
                            stuck in — every accepted swap is still checked
                            to guarantee it never reintroduces a hard clash.

This replaces the earlier 4-algorithm setup (GA / SA / CSP / Q-Learning),
which had three algorithms that were mostly "for show" and a bug that
crashed 3 of the 4 API responses. This hybrid is fast, and it directly
optimizes for what the app promises: zero teacher/room conflicts, with the
best schedule quality achievable on top of that guarantee.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import random, copy, time
from collections import defaultdict

app = Flask(__name__)
CORS(app)

DAY_ORDER = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6,
}

# ─────────────────────────────────────────────
#  Data helpers
# ─────────────────────────────────────────────

def sorted_days(config):
    return sorted(config["days"], key=lambda d: DAY_ORDER.get(d, 99))


def slot_times(config):
    """Human-readable time labels per slot index."""
    h, m = map(int, config["start"].split(":"))
    cur = h * 60 + m
    dur = config["dur"]
    break_after = config.get("breakAfter", 3)
    times = []
    for i in range(config["perday"]):
        sh, sm = divmod(cur, 60)
        end = cur + dur
        eh, em = divmod(end, 60)
        times.append(f"{sh:02d}:{sm:02d}\u2013{eh:02d}:{em:02d}")
        cur = end
        if i + 1 == break_after:
            cur += 20  # 20-min break
    return times


def build_maps(data):
    subjects_map = {s["id"]: s for s in data.get("subjects", [])}
    teachers_map = {t["id"]: t for t in data.get("teachers", [])}
    rooms_map = {r["id"]: r for r in data.get("rooms", [])}
    return subjects_map, teachers_map, rooms_map


def find_teacher(sid, teachers_map):
    for t in teachers_map.values():
        if sid in t.get("subjects", []):
            return t["id"]
    return None


def find_room(sid, subjects_map, rooms_map):
    stype = subjects_map[sid].get("stype", "theory")
    for r in rooms_map.values():
        if stype == "lab" and r.get("rtype") == "lab":
            return r["id"]
        if stype != "lab" and r.get("rtype") != "lab":
            return r["id"]
    return list(rooms_map.keys())[0] if rooms_map else None


def generate_tasks(data, subjects_map, teachers_map, rooms_map):
    """Expand subjects into (subject_id, teacher_id, room_id, section) tasks x lpw."""
    tasks = []
    for s in data["subjects"]:
        sid = s["id"]
        sect = s.get("section", "Sem 5")
        tid = find_teacher(sid, teachers_map)
        rid = find_room(sid, subjects_map, rooms_map)
        if tid and rid:
            for _ in range(s.get("lpw", 1)):
                tasks.append({"subject": sid, "teacher": tid, "room": rid, "section": sect})
    return tasks


def empty_schedule(slots):
    return {s: None for s in slots}


# ─────────────────────────────────────────────
#  Penalty scorer (shared)
# ─────────────────────────────────────────────

def score_schedule(schedule, subjects_map, teachers_map, rooms_map):
    """Lower = better. Hard constraints (1000 pts) should always be 0 by
    construction; soft constraints are what the polish pass optimizes."""
    penalty = 0
    teacher_slots = defaultdict(set)
    room_slots = defaultdict(set)
    subj_days = defaultdict(set)
    subj_last = {}

    for key, entry in schedule.items():
        if entry is None:
            continue
        sect, day, si = key
        sid, tid, rid = entry["subject"], entry["teacher"], entry["room"]
        slot_key = (day, si)

        if slot_key in teacher_slots[tid]:
            penalty += 1000
        teacher_slots[tid].add(slot_key)

        if slot_key in room_slots[rid]:
            penalty += 1000
        room_slots[rid].add(slot_key)

        subj = subjects_map.get(sid, {})
        room = rooms_map.get(rid, {})
        if subj.get("stype") == "lab" and room.get("rtype") != "lab":
            penalty += 50
        if subj.get("stype") == "theory" and room.get("rtype") == "lab":
            penalty += 20

        last_key = (sid, day)
        if last_key in subj_last and abs(subj_last[last_key] - si) == 1:
            penalty += 15
        subj_last[(sid, day)] = si

        subj_days[sid].add(day)

    for sid, days_used in subj_days.items():
        subj = subjects_map.get(sid, {})
        lpw = subj.get("lpw", 1)
        if lpw > 1 and len(days_used) < min(lpw, 3):
            penalty += 10 * (min(lpw, 3) - len(days_used))

    return penalty


# ─────────────────────────────────────────────
#  Step 1: CSP backtracking (hard constraints only)
# ─────────────────────────────────────────────

def csp_backtrack(tasks, slots, attempts=6):
    """Find a hard-constraint-clean assignment. Retries with different
    random orderings if a particular ordering dead-ends (rare given the
    slot/task ratios this app targets)."""
    for _ in range(attempts):
        teacher_used = defaultdict(set)
        room_used = defaultdict(set)
        section_used = defaultdict(set)
        assignment = {}

        slots_by_section = defaultdict(list)
        for s in slots:
            slots_by_section[s[0]].append(s)
        for sect in slots_by_section:
            random.shuffle(slots_by_section[sect])

        order = list(range(len(tasks)))
        random.shuffle(order)

        def is_consistent(slot, task):
            sect, day, si = slot
            tid, rid = task["teacher"], task["room"]
            slot_key = (day, si)
            return (slot_key not in teacher_used[tid] and
                    slot_key not in room_used[rid] and
                    slot not in section_used[sect])

        def backtrack(pos):
            if pos == len(order):
                return True
            idx = order[pos]
            task = tasks[idx]
            sect = task["section"]
            candidates = [s for s in slots_by_section[sect] if s not in assignment]
            random.shuffle(candidates)
            for slot in candidates:
                if is_consistent(slot, task):
                    sect2, day, si = slot
                    assignment[slot] = task
                    teacher_used[task["teacher"]].add((day, si))
                    room_used[task["room"]].add((day, si))
                    section_used[sect].add(slot)
                    if backtrack(pos + 1):
                        return True
                    del assignment[slot]
                    teacher_used[task["teacher"]].discard((day, si))
                    room_used[task["room"]].discard((day, si))
                    section_used[sect].discard(slot)
            return False

        if backtrack(0):
            schedule = empty_schedule(slots)
            for slot, task in assignment.items():
                schedule[slot] = task
            return schedule, True

    # Fallback: best-effort greedy placement (guarantees a result even if
    # a fully clash-free assignment couldn't be found within the attempts)
    schedule = empty_schedule(slots)
    teacher_used = defaultdict(set)
    room_used = defaultdict(set)
    slots_by_section = defaultdict(list)
    for s in slots:
        slots_by_section[s[0]].append(s)
    for sect in slots_by_section:
        random.shuffle(slots_by_section[sect])
    used_slots = set()
    for task in tasks:
        sect = task["section"]
        placed = False
        for slot in slots_by_section[sect]:
            if slot in used_slots:
                continue
            day, si = slot[1], slot[2]
            if (day, si) not in teacher_used[task["teacher"]] and (day, si) not in room_used[task["room"]]:
                schedule[slot] = task
                used_slots.add(slot)
                teacher_used[task["teacher"]].add((day, si))
                room_used[task["room"]].add((day, si))
                placed = True
                break
        if not placed:
            for slot in slots_by_section[sect]:
                if slot not in used_slots:
                    schedule[slot] = task
                    used_slots.add(slot)
                    break
    return schedule, False


# ─────────────────────────────────────────────
#  Step 2: Simulated Annealing polish (soft constraints)
# ─────────────────────────────────────────────

def local_search_polish(schedule, subjects_map, teachers_map, rooms_map, slots,
                          iterations=1500, t_start=8.0, t_end=0.02):
    """Simulated Annealing over slot-swaps within a section.

    Why SA instead of plain hill-climbing: hill-climbing only ever accepts
    a swap that helps, so it can get permanently stuck in a local optimum
    (e.g. two labs stuck adjacent to each other with no single swap that
    improves things). SA occasionally accepts a *worse* swap while the
    "temperature" is high, which lets it hop out of those traps, then
    cools down and settles into a much better optimum than hill-climbing
    finds on the same problem.

    Hard constraints (teacher/room clashes) are enforced completely
    separately from the annealing acceptance rule: a swap is only ever
    considered if it does not increase hard-constraint violations, no
    matter what the temperature is. So a clash-free schedule can never
    become clash-prone during polishing — only the soft-constraint
    quality is being annealed.
    """
    history = []
    current = dict(schedule)
    current_score = score_schedule(current, subjects_map, teachers_map, rooms_map)
    best = copy.deepcopy(current)
    best_score = current_score

    slots_by_section = defaultdict(list)
    for s in slots:
        slots_by_section[s[0]].append(s)

    def hard_violations(sched):
        teacher_slots = defaultdict(set)
        room_slots = defaultdict(set)
        v = 0
        for key, entry in sched.items():
            if entry is None:
                continue
            _, day, si = key
            slot_key = (day, si)
            if slot_key in teacher_slots[entry["teacher"]]:
                v += 1
            teacher_slots[entry["teacher"]].add(slot_key)
            if slot_key in room_slots[entry["room"]]:
                v += 1
            room_slots[entry["room"]].add(slot_key)
        return v

    current_hard = hard_violations(current)
    history.append({"iteration": 0, "penalty": current_score})

    cooling = (t_end / t_start) ** (1.0 / iterations)
    T = t_start

    for it in range(1, iterations + 1):
        sect = random.choice(list(slots_by_section.keys()))
        sect_slots = slots_by_section[sect]
        filled = [s for s in sect_slots if current[s] is not None]
        if len(filled) < 2:
            T *= cooling
            continue
        a, b = random.sample(filled, 2)

        neighbor = dict(current)
        neighbor[a], neighbor[b] = neighbor[b], neighbor[a]

        n_hard = hard_violations(neighbor)
        if n_hard > current_hard:
            T *= cooling
            continue  # never allow a swap that creates new clashes

        n_score = score_schedule(neighbor, subjects_map, teachers_map, rooms_map)
        delta = n_score - current_score

        # SA acceptance: always take improvements, sometimes take a
        # worse move (probability shrinks as T cools).
        if delta <= 0 or random.random() < pow(2.71828, -delta / max(T, 1e-9)):
            current = neighbor
            current_score = n_score
            current_hard = n_hard
            if current_score < best_score:
                best = copy.deepcopy(current)
                best_score = current_score

        if it % 50 == 0:
            history.append({"iteration": it, "penalty": best_score})

        T *= cooling
        if best_score == 0 and it > iterations // 6:
            break

    if not history or history[-1]["iteration"] != it:
        history.append({"iteration": it, "penalty": best_score})
    return best, history


def solve_schedule(data, config):
    subjects_map, teachers_map, rooms_map = build_maps(data)
    tasks = generate_tasks(data, subjects_map, teachers_map, rooms_map)

    if not tasks:
        return {}, []

    days = sorted_days(config)
    sections = sorted(list(set(t["section"] for t in tasks)))
    slots = [(sect, day, si) for sect in sections for day in days for si in range(config["perday"])]

    schedule, fully_consistent = csp_backtrack(tasks, slots)
    schedule, history = local_search_polish(schedule, subjects_map, teachers_map, rooms_map, slots)
    return schedule, history


# ─────────────────────────────────────────────
#  API Routes
# ─────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
def generate():
    body = request.json or {}
    data = body.get("data", {})
    config = body.get("config", {})

    t0 = time.time()
    try:
        subjects_map, teachers_map, rooms_map = build_maps(data)

        for s in data.get("subjects", []):
            sid = s["id"]
            name = s.get("name", "Unknown Subject")
            code = s.get("code", "")
            code_str = f" ({code})" if code else ""

            tid = find_teacher(sid, teachers_map)
            if not tid:
                return jsonify({"error": f"Subject '{name}'{code_str} has no teacher assigned. Please edit a teacher and select this subject."}), 400

            rid = find_room(sid, subjects_map, rooms_map)
            if not rid:
                return jsonify({"error": f"Subject '{name}'{code_str} has no room available. Please ensure rooms are configured."}), 400

        schedule, history = solve_schedule(data, config)
        penalty = score_schedule(schedule, subjects_map, teachers_map, rooms_map)
        times = slot_times(config)

        serialized = {}
        for (sect, day, si), val in schedule.items():
            key = f"{sect}|{day}|{si}"
            if val:
                entry = dict(val)
                entry["time"] = times[si] if si < len(times) else ""
                entry["slotIndex"] = si
                entry["day"] = day
                entry["section"] = sect
                serialized[key] = entry

        return jsonify({
            "schedule": serialized,
            "penalty": penalty,
            "clashFree": penalty == 0,
            "history": history,
            "algorithm": "csp_sa_hybrid",
            "elapsed": round(time.time() - t0, 2),
            "slotTimes": times,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "algorithm": "csp_sa_hybrid"})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
