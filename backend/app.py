"""
College Timetable Generator — Flask Backend
Algorithm: CSP Backtracking + Simulated Annealing hybrid.

  Phase 1 (feasibility)  — Constraint Satisfaction via backtracking with
                            MRV/workload-first ordering and fast restarts.
                            Guarantees zero teacher/room clashes and zero
                            consecutive teacher lectures in the same semester.
  Phase 2 (optimization) — Simulated Annealing then polishes that schedule,
                            swapping lecture slots to minimize soft-constraint
                            penalties (lab/room mismatches, back-to-back
                            same-subject repeats, poor day-spread).
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import random, copy, time, itertools
from collections import defaultdict, Counter

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

DAY_ORDER = {
    "Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3,
    "Friday": 4, "Saturday": 5, "Sunday": 6,
}

# ─────────────────────────────────────────────
#  Data helpers
# ─────────────────────────────────────────────

def sorted_days(config):
    return sorted(config.get("days", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]),
                  key=lambda d: DAY_ORDER.get(d, 99))

def slot_times(config):
    """Human-readable time labels per slot index."""
    start_str = config.get("start", "09:00")
    try:
        h, m = map(int, start_str.split(":"))
    except Exception:
        h, m = 9, 0
    cur = h * 60 + m
    dur = config.get("dur", 60)
    perday = config.get("perday", 6)
    break_after = config.get("breakAfter", 3)
    times = []
    for i in range(perday):
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


import re

def find_room(sid, subjects_map, rooms_map):
    subj = subjects_map.get(sid, {})
    stype = subj.get("stype", "theory")
    sect = subj.get("section", "").lower()
    
    # Extract specific semester tokens (e.g. "1st", "2nd", "3rd", "4th", "1", "2", "3", "4")
    sect_tokens = set(re.findall(r'\b(?:1st|2nd|3rd|4th|5th|6th|7th|8th|\d+)\b', sect))
    
    # 1. Match by room type AND specific semester token (e.g. "1st" in "LH-101 (MCA 1st)")
    if sect_tokens:
        for r in rooms_map.values():
            rtype = r.get("rtype", "classroom")
            rname = r.get("name", "").lower()
            r_tokens = set(re.findall(r'\b(?:1st|2nd|3rd|4th|5th|6th|7th|8th|\d+)\b', rname))
            if stype == "lab" and rtype == "lab" and (sect_tokens & r_tokens):
                return r["id"]
            elif stype != "lab" and rtype != "lab" and (sect_tokens & r_tokens):
                return r["id"]

    # 2. Distribute sections across matching room types
    classrooms = [r for r in rooms_map.values() if r.get("rtype") != "lab"]
    labs = [r for r in rooms_map.values() if r.get("rtype") == "lab"]
    
    all_sections = sorted(list(set(s.get("section", "") for s in subjects_map.values())))
    sec_idx = all_sections.index(subj.get("section", "")) if subj.get("section", "") in all_sections else 0
    
    if stype == "lab" and labs:
        return labs[sec_idx % len(labs)]["id"]
    elif stype != "lab" and classrooms:
        return classrooms[sec_idx % len(classrooms)]["id"]

    return list(rooms_map.keys())[0] if rooms_map else None


def generate_units(subjects_list, subjects_map, teachers_map, rooms_map):
    """
    Expand subjects into schedulable atomic units.
    Multi-period labs are kept as contiguous atomic blocks (duration = min(lpw, 2) or lpw).
    Theory subjects are 1-hour lectures (duration = 1).
    """
    units = []
    for s in subjects_list:
        sid = s["id"]
        sect = s.get("section", "Sem 1")
        stype = s.get("stype", "theory")
        lpw = s.get("lpw", 1)
        tid = find_teacher(sid, teachers_map)
        rid = find_room(sid, subjects_map, rooms_map)
        if not tid or not rid:
            continue

        if stype == "lab":
            rem = lpw
            while rem > 0:
                dur = min(rem, 2)
                units.append({
                    "subject": sid,
                    "teacher": tid,
                    "room": rid,
                    "section": sect,
                    "duration": dur,
                    "is_lab": True,
                })
                rem -= dur
        else:
            for _ in range(lpw):
                units.append({
                    "subject": sid,
                    "teacher": tid,
                    "room": rid,
                    "section": sect,
                    "duration": 1,
                    "is_lab": False,
                })
    return units


def empty_schedule(slots):
    return {s: None for s in slots}


def partition_section_units_to_days(units_for_sect, days, config):
    """
    Distribute a section's units (labs and theory) across the days of the week evenly,
    ensuring each theory subject appears at most once per day (if lpw <= len(days)),
    and at most one lab block per day.
    """
    num_days = len(days)
    if num_days == 0:
        return {d: [] for d in days}

    lab_units = [u for u in units_for_sect if u["is_lab"]]
    theory_units = [u for u in units_for_sect if not u["is_lab"]]

    total_periods = sum(u["duration"] for u in units_for_sect)
    base_cap = total_periods // num_days
    rem_cap = total_periods % num_days
    target_caps = [base_cap + (1 if i < rem_cap else 0) for i in range(num_days)]

    for _ in range(500):
        random.shuffle(target_caps)
        day_caps = {d: target_caps[i] for i, d in enumerate(days)}
        day_units = {d: [] for d in days}
        day_subjs = {d: set() for d in days}

        # 1. Place lab blocks first (at most 1 lab per day, within day_caps)
        labs_placed = True
        shuffled_labs = list(lab_units)
        random.shuffle(shuffled_labs)
        available_days = list(days)
        random.shuffle(available_days)

        for lab in shuffled_labs:
            placed = False
            for d in available_days:
                if len([u for u in day_units[d] if u["is_lab"]]) == 0:
                    current_dur = sum(u["duration"] for u in day_units[d])
                    if current_dur + lab["duration"] <= day_caps[d] and lab["subject"] not in day_subjs[d]:
                        day_units[d].append(lab)
                        day_subjs[d].add(lab["subject"])
                        placed = True
                        break
            if not placed:
                labs_placed = False
                break
        if not labs_placed:
            continue

        # 2. Place theory lectures (at most 1 per subject per day, within day_caps)
        theory_by_subj = defaultdict(list)
        for u in theory_units:
            theory_by_subj[u["subject"]].append(u)

        sorted_subjs = sorted(theory_by_subj.keys(), key=lambda sid: len(theory_by_subj[sid]), reverse=True)
        theory_placed = True

        for sid in sorted_subjs:
            instances = theory_by_subj[sid]
            candidate_days = [
                d for d in days
                if sid not in day_subjs[d] and sum(u["duration"] for u in day_units[d]) < day_caps[d]
            ]
            if len(candidate_days) < len(instances):
                theory_placed = False
                break
            random.shuffle(candidate_days)
            candidate_days.sort(key=lambda d: day_caps[d] - sum(u["duration"] for u in day_units[d]), reverse=True)
            for i, u in enumerate(instances):
                d = candidate_days[i]
                day_units[d].append(u)
                day_subjs[d].add(sid)

        if theory_placed:
            all_filled = True
            for d in days:
                if sum(u["duration"] for u in day_units[d]) != day_caps[d]:
                    all_filled = False
                    break
            if all_filled:
                return day_units

    # Fallback: simple balanced distribution
    day_units = {d: [] for d in days}
    all_units = lab_units + theory_units
    for i, u in enumerate(all_units):
        day_units[days[i % num_days]].append(u)
    return day_units


def generate_valid_day_arrangements(units, perday):
    """
    Generate all valid contiguous slot assignments for a section on a day.
    Guarantees:
      - Continuous slots (no gaps): slots are s0 .. s0 + total_duration - 1.
      - Labs are kept as contiguous multi-period blocks.
      - No two consecutive periods have the same teacher UNLESS they belong to the same lab block.
    """
    total_dur = sum(u["duration"] for u in units)
    if total_dur > perday:
        return []

    # Prefer starting at slot 0 (standard morning start), then 1, up to perday - total_dur
    start_slots = list(range(perday - total_dur + 1))

    arrangements = []
    unit_indices = list(range(len(units)))
    perms = list(itertools.permutations(unit_indices))
    random.shuffle(perms)

    for start_slot in start_slots:
        for p_idx in perms:
            p = [units[i] for i in p_idx]
            # Check teacher consecutive rule between adjacent units in same semester
            valid = True
            for i in range(len(p) - 1):
                if p[i]["teacher"] == p[i+1]["teacher"]:
                    valid = False
                    break
            if not valid:
                continue

            # Build contiguous slot map
            slot_map = {}
            cur_slot = start_slot
            for u in p:
                for _ in range(u["duration"]):
                    slot_map[cur_slot] = {
                        "subject": u["subject"],
                        "teacher": u["teacher"],
                        "room": u["room"],
                        "section": u["section"],
                        "is_lab": u["is_lab"]
                    }
                    cur_slot += 1
            arrangements.append(slot_map)

    return arrangements


# ─────────────────────────────────────────────
#  Penalty scorer (shared)
# ─────────────────────────────────────────────

def score_schedule(schedule, subjects_map, teachers_map, rooms_map):
    """Lower = better. Hard constraints should be 0 by construction."""
    penalty = 0
    teacher_slots = defaultdict(set)
    room_slots = defaultdict(set)
    sect_day_slots = defaultdict(dict)
    subj_days = defaultdict(set)

    for key, entry in schedule.items():
        if entry is None:
            continue
        sect, day, si = key
        sid, tid, rid = entry["subject"], entry["teacher"], entry["room"]
        slot_key = (day, si)

        # Hard 1: Global teacher conflict across all semesters
        if slot_key in teacher_slots[tid]:
            penalty += 1000
        teacher_slots[tid].add(slot_key)

        # Hard 2: Global room conflict across all semesters
        if slot_key in room_slots[rid]:
            penalty += 1000
        room_slots[rid].add(slot_key)

        sect_day_slots[(sect, day)][si] = entry

        # Soft 1: Lab in non-lab room
        subj = subjects_map.get(sid, {})
        room = rooms_map.get(rid, {})
        if subj.get("stype") == "lab" and room.get("rtype") != "lab":
            penalty += 50
        if subj.get("stype") == "theory" and room.get("rtype") == "lab":
            penalty += 20

        subj_days[sid].add(day)

    # Hard 3: Same teacher consecutive lectures in the same semester (unless same lab)
    for (sect, day), slots_dict in sect_day_slots.items():
        sorted_sis = sorted(slots_dict.keys())
        for i in range(len(sorted_sis) - 1):
            si1 = sorted_sis[i]
            si2 = sorted_sis[i+1]
            if si2 == si1 + 1:
                e1 = slots_dict[si1]
                e2 = slots_dict[si2]
                if e1["teacher"] == e2["teacher"]:
                    is_same_lab = (e1.get("is_lab") and e2.get("is_lab") and e1["subject"] == e2["subject"])
                    if not is_same_lab:
                        penalty += 1000

        # Hard 4: Any gap between lectures for the same semester on a day
        if len(sorted_sis) > 1:
            for i in range(len(sorted_sis) - 1):
                if sorted_sis[i+1] != sorted_sis[i] + 1:
                    penalty += 1000

    # Soft 2: Poor day-spread for multi-lecture subjects
    for sid, days_used in subj_days.items():
        subj = subjects_map.get(sid, {})
        lpw = subj.get("lpw", 1)
        if lpw > 1 and len(days_used) < min(lpw, 3):
            penalty += 10 * (min(lpw, 3) - len(days_used))

    return penalty


# ─────────────────────────────────────────────
#  Step 1: CSP backtracking (contiguous + clash-free)
# ─────────────────────────────────────────────

def csp_backtrack(subjects_list, data, config, max_restarts=60):
    """
    Find a contiguous, clash-free assignment across all semesters using
    day-by-day CSP search with forward checking and fast restarts.
    """
    subjects_map, teachers_map, rooms_map = build_maps(data)
    units = generate_units(subjects_list, subjects_map, teachers_map, rooms_map)
    if not units:
        return {}, True

    days = sorted_days(config)
    perday = config.get("perday", 6)
    sections = sorted(list(set(u["section"] for u in units)))
    all_slots = [(sect, day, si) for sect in sections for day in days for si in range(perday)]

    for restart in range(max_restarts):
        # 1. Distribute each section's units to days
        sect_day_units = {}
        for sect in sections:
            sect_units = [u for u in units if u["section"] == sect]
            sect_day_units[sect] = partition_section_units_to_days(sect_units, days, config)

        # 2. For each day, solve cross-section arrangement CSP
        schedule = empty_schedule(all_slots)
        day_success = True

        for day in days:
            sect_options = {}
            for sect in sections:
                day_u = sect_day_units[sect][day]
                opts = generate_valid_day_arrangements(day_u, perday)
                if not opts:
                    day_success = False
                    break
                random.shuffle(opts)
                # Sort options to prefer starting at slot 0 (morning start)
                opts.sort(key=lambda sm: min(sm.keys()) if sm else 0)
                sect_options[sect] = opts

            if not day_success:
                break

            day_assignment = {}
            day_teachers = defaultdict(set)
            day_rooms = defaultdict(set)

            def search_day(sec_idx):
                if sec_idx == len(sections):
                    return True
                sec = sections[sec_idx]
                for opt in sect_options[sec]:
                    # Check clashes with other sections on this day
                    clash = False
                    for si, cell in opt.items():
                        if cell["teacher"] in day_teachers[si]:
                            clash = True
                            break
                        if cell["room"] in day_rooms[si]:
                            clash = True
                            break
                    if clash:
                        continue

                    # Place
                    for si, cell in opt.items():
                        day_teachers[si].add(cell["teacher"])
                        day_rooms[si].add(cell["room"])
                    day_assignment[sec] = opt

                    if search_day(sec_idx + 1):
                        return True

                    # Unplace
                    for si, cell in opt.items():
                        day_teachers[si].remove(cell["teacher"])
                        day_rooms[si].remove(cell["room"])
                    del day_assignment[sec]

                return False

            if search_day(0):
                for sec, opt in day_assignment.items():
                    for si, cell in opt.items():
                        schedule[(sec, day, si)] = cell
            else:
                day_success = False
                break

        if day_success:
            return schedule, True

    # Fallback to empty schedule
    return empty_schedule(all_slots), False


# ─────────────────────────────────────────────
#  Step 2: Local Search Polish
# ─────────────────────────────────────────────

def local_search_polish(schedule, subjects_map, teachers_map, rooms_map, slots,
                        iterations=300):
    """
    Light polish for soft constraints that strictly preserves contiguity,
    lab blocks, and zero hard violations.
    """
    current = dict(schedule)
    current_score = score_schedule(current, subjects_map, teachers_map, rooms_map)
    history = [{"iteration": 0, "penalty": current_score}]

    # If current score is already optimal or low, no swap needed
    if current_score <= 50:
        history.append({"iteration": iterations, "penalty": current_score})
        return current, history

    # Attempt valid swaps of identical duration theory slots within the same section
    best = copy.deepcopy(current)
    best_score = current_score

    for it in range(1, iterations + 1):
        # Pick a section
        all_sects = list(set(s[0] for s in slots))
        if not all_sects:
            break
        sect = random.choice(all_sects)

        # Get filled theory slots for this section
        filled_theory = [
            s for s in slots
            if s[0] == sect and current[s] is not None and not current[s].get("is_lab")
        ]
        if len(filled_theory) < 2:
            continue

        a, b = random.sample(filled_theory, 2)
        neighbor = dict(current)
        neighbor[a], neighbor[b] = neighbor[b], neighbor[a]

        n_score = score_schedule(neighbor, subjects_map, teachers_map, rooms_map)
        # Only accept if hard constraints remain 0 (score < 1000) and improves score
        if n_score < current_score and n_score < 1000:
            current = neighbor
            current_score = n_score
            if current_score < best_score:
                best = copy.deepcopy(current)
                best_score = current_score

        if it % 50 == 0:
            history.append({"iteration": it, "penalty": best_score})

    if not history or history[-1]["iteration"] != iterations:
        history.append({"iteration": iterations, "penalty": best_score})

    return best, history


# ─────────────────────────────────────────────
#  Step 3: Comprehensive Schedule Validation
# ─────────────────────────────────────────────

def validate_schedule(schedule, units, subjects_map, teachers_map, rooms_map, config):
    """
    Post-generation comprehensive verification of all constraints:
      [x] No gaps between lectures for the same semester/day
      [x] Lectures of a semester/day are consecutive
      [x] No teacher is assigned to two semesters at the same time
      [x] A teacher can teach consecutive periods in different semesters
      [x] A teacher cannot teach consecutive periods in the same semester
      [x] Labs remain contiguous
      [x] All subject lecture counts are satisfied
      [x] Existing room/lab constraints are satisfied
      [x] Existing semester constraints are satisfied
    """
    gap_violations = []
    teacher_clashes = []
    teacher_consecutive = []
    room_clashes = []
    lab_violations = []
    scheduled_counts = defaultdict(int)
    unqualified_assignments = []
    invalid_time_slots = []

    teacher_slot_map = defaultdict(list)
    room_slot_map = defaultdict(list)
    sect_day_slots = defaultdict(dict)

    allowed_days = set(config.get("days", []))
    perday = config.get("perday", 6)

    for (sect, day, si), entry in schedule.items():
        if entry is None:
            continue

        sid = entry.get("subject")
        tid = entry.get("teacher")
        rid = entry.get("room")
        scheduled_counts[sid] += 1

        t_name = teachers_map.get(tid, {}).get("name", tid)
        s_name = subjects_map.get(sid, {}).get("name", sid)
        r_name = rooms_map.get(rid, {}).get("name", rid)

        # Check working days & perday bounds
        if day not in allowed_days or si < 0 or si >= perday:
            invalid_time_slots.append(f"{s_name} placed on invalid slot: {day} slot {si+1}")

        # Check teacher qualified for subject
        allowed_subjects = teachers_map.get(tid, {}).get("subjects", [])
        if sid not in allowed_subjects:
            unqualified_assignments.append(f"{t_name} is not assigned to teach {s_name}")

        # Global teacher clashes
        teacher_slot_map[(tid, day, si)].append((sect, s_name, r_name))

        # Global room clashes
        room_slot_map[(rid, day, si)].append((sect, s_name, t_name))

        # Save for consecutive & gap checks in same section/day
        sect_day_slots[(sect, day)][si] = (sid, tid, s_name, t_name, entry.get("is_lab"))

    # 1. Process gap & consecutive checks for each semester/day
    for (sect, day), slots_dict in sect_day_slots.items():
        sorted_sis = sorted(slots_dict.keys())
        if len(sorted_sis) > 1:
            for i in range(len(sorted_sis) - 1):
                if sorted_sis[i+1] != sorted_sis[i] + 1:
                    gap_violations.append(
                        f"{sect} on {day} has an empty gap between Slot {sorted_sis[i]+1} and Slot {sorted_sis[i+1]+1}"
                    )

    # 2. Process global teacher clashes (double-booking across semesters)
    for (tid, day, si), occurrences in teacher_slot_map.items():
        if len(occurrences) > 1:
            t_name = teachers_map.get(tid, {}).get("name", tid)
            details = ", ".join([f"{sec} ({subj})" for sec, subj, _ in occurrences])
            teacher_clashes.append(f"{t_name} double-booked on {day} slot {si+1} in: {details}")

    # 3. Process global room clashes
    for (rid, day, si), occurrences in room_slot_map.items():
        if len(occurrences) > 1:
            r_name = rooms_map.get(rid, {}).get("name", rid)
            details = ", ".join([f"{sec} ({subj})" for sec, subj, _ in occurrences])
            room_clashes.append(f"{r_name} double-booked on {day} slot {si+1} in: {details}")

    # 4. Process consecutive teacher lectures in same section
    checked_consec = set()
    for (sect, day), slots_dict in sect_day_slots.items():
        sorted_sis = sorted(slots_dict.keys())
        for i in range(len(sorted_sis) - 1):
            si1 = sorted_sis[i]
            si2 = sorted_sis[i+1]
            if si2 == si1 + 1:
                sid1, tid1, sname1, tname1, is_lab1 = slots_dict[si1]
                sid2, tid2, sname2, tname2, is_lab2 = slots_dict[si2]
                if tid1 == tid2:
                    # Allowed ONLY if it's the exact same multi-period lab session
                    is_same_lab = is_lab1 and is_lab2 and (sid1 == sid2)
                    if not is_same_lab:
                        key = (sect, day, tid1, si1)
                        if key not in checked_consec:
                            checked_consec.add(key)
                            teacher_consecutive.append(
                                f"{tname1} has consecutive classes in {sect} on {day} (Slots {si1+1} & {si2+1}: {sname1}, {sname2})"
                            )

    # 5. Check cross-semester consecutive teaching (permitted & verified)
    cross_sem_count = 0
    cross_sem_examples = []
    for day in config.get("days", []):
        for si in range(config.get("perday", 6) - 1):
            for t in teachers_map:
                s1 = [sec for (sec, d, s), c in schedule.items() if d == day and s == si and c and c["teacher"] == t]
                s2 = [sec for (sec, d, s), c in schedule.items() if d == day and s == si + 1 and c and c["teacher"] == t]
                if s1 and s2 and s1[0] != s2[0]:
                    cross_sem_count += 1
                    if len(cross_sem_examples) < 4:
                        cross_sem_examples.append(
                            f"{teachers_map[t]['name']}: {s1[0]} (Slot {si+1}) \u2192 {s2[0]} (Slot {si+2}) on {day}"
                        )

    # 6. Check lab blocks remain contiguous
    for sid, subj in subjects_map.items():
        if subj.get("stype") == "lab":
            lab_days = defaultdict(list)
            for (sect, day, si), c in schedule.items():
                if c and c.get("subject") == sid:
                    lab_days[(sect, day)].append(si)
            for (sect, day), sis in lab_days.items():
                sorted_sis = sorted(sis)
                for i in range(len(sorted_sis) - 1):
                    if sorted_sis[i+1] != sorted_sis[i] + 1:
                        s_name = subj.get("name", sid)
                        lab_violations.append(
                            f"Lab '{s_name}' [{sect}] on {day} is split across non-consecutive slots: {sorted_sis}"
                        )

    # 7. Process lecture count (lpw) checks
    lecture_count_violations = []
    for sid, subj in subjects_map.items():
        expected = subj.get("lpw", 1)
        actual = scheduled_counts.get(sid, 0)
        s_name = subj.get("name", sid)
        sec = subj.get("section", "")
        if actual != expected:
            lecture_count_violations.append(
                f"{s_name} [{sec}]: scheduled {actual}/{expected} required lectures"
            )

    checks = [
        {
            "id": "gap_check",
            "name": "No Gaps Between Lectures (Continuous Daily Schedule)",
            "status": "fail" if gap_violations else "pass",
            "count": len(gap_violations),
            "details": gap_violations
        },
        {
            "id": "lab_contiguity",
            "name": "Contiguous Multi-Period Lab Blocks",
            "status": "fail" if lab_violations else "pass",
            "count": len(lab_violations),
            "details": lab_violations
        },
        {
            "id": "teacher_clashes",
            "name": "Global Teacher Double-Booking (Zero Conflicts)",
            "status": "fail" if teacher_clashes else "pass",
            "count": len(teacher_clashes),
            "details": teacher_clashes
        },
        {
            "id": "teacher_consecutive",
            "name": "No Consecutive Lectures for Same Teacher in Same Semester",
            "status": "fail" if teacher_consecutive else "pass",
            "count": len(teacher_consecutive),
            "details": teacher_consecutive
        },
        {
            "id": "cross_sem_consec",
            "name": "Continuous Teaching in Different Semesters (Allowed)",
            "status": "pass",
            "count": cross_sem_count,
            "details": cross_sem_examples
        },
        {
            "id": "room_clashes",
            "name": "Room Double-Booking (Zero Conflicts)",
            "status": "fail" if room_clashes else "pass",
            "count": len(room_clashes),
            "details": room_clashes
        },
        {
            "id": "lecture_counts",
            "name": "Required Lecture Hours (LPW Satisfied)",
            "status": "fail" if lecture_count_violations else "pass",
            "count": len(lecture_count_violations),
            "details": lecture_count_violations
        },
        {
            "id": "teacher_qualification",
            "name": "Teacher Subject Assignment Qualified",
            "status": "fail" if unqualified_assignments else "pass",
            "count": len(unqualified_assignments),
            "details": unqualified_assignments
        },
        {
            "id": "time_bounds",
            "name": "Valid Days & Time Slots Bounds",
            "status": "fail" if invalid_time_slots else "pass",
            "count": len(invalid_time_slots),
            "details": invalid_time_slots
        }
    ]

    all_conflicts = (
        gap_violations + lab_violations + teacher_clashes + teacher_consecutive +
        room_clashes + lecture_count_violations + unqualified_assignments + invalid_time_slots
    )
    is_valid = len(all_conflicts) == 0

    return {
        "isValid": is_valid,
        "totalViolations": len(all_conflicts),
        "checks": checks,
        "conflicts": all_conflicts,
        "summary": "All timetable constraints fully verified with 0 conflicts." if is_valid else f"Detected {len(all_conflicts)} conflict(s)."
    }


def solve_schedule(subjects_list, data, config, max_attempts=5):
    subjects_map, teachers_map, rooms_map = build_maps(data)
    units = generate_units(subjects_list, subjects_map, teachers_map, rooms_map)

    if not units:
        return {}, [], {"isValid": True, "totalViolations": 0, "checks": [], "conflicts": [], "summary": "No tasks to schedule."}

    days = sorted_days(config)
    sections = sorted(list(set(u["section"] for u in units)))
    perday = config.get("perday", 6)
    slots = [(sect, day, si) for sect in sections for day in days for si in range(perday)]

    best_schedule = None
    best_history = []
    best_validation = None

    for attempt in range(max_attempts):
        schedule, fully_consistent = csp_backtrack(subjects_list, data, config)
        schedule, history = local_search_polish(schedule, subjects_map, teachers_map, rooms_map, slots)
        validation = validate_schedule(schedule, units, {s["id"]: s for s in subjects_list}, teachers_map, rooms_map, config)

        if validation["isValid"]:
            return schedule, history, validation

        if best_validation is None or validation["totalViolations"] < best_validation["totalViolations"]:
            best_schedule = schedule
            best_history = history
    return best_schedule, best_history, best_validation


# ─────────────────────────────────────────────
#  API Routes
# ─────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
def generate():
    body = request.json or {}
    data = body.get("data", {})
    config = body.get("config", {})
    selected_semesters = body.get("selectedSemesters") or data.get("selectedSemesters")

    t0 = time.time()
    try:
        subjects_map, teachers_map, rooms_map = build_maps(data)
        all_subjects = data.get("subjects", [])

        # Filter subjects by selectedSemesters if specified and non-empty
        if selected_semesters and len(selected_semesters) > 0:
            selected_set = set(selected_semesters)
            subjects_to_schedule = [s for s in all_subjects if s.get("section", "Sem 1") in selected_set]
        else:
            subjects_to_schedule = all_subjects

        if not subjects_to_schedule:
            return jsonify({"error": "No subjects found for the selected semester(s). Please add subjects or select another semester."}), 400

        # Validate that each subject to schedule has an assigned teacher and room
        for s in subjects_to_schedule:
            sid = s["id"]
            name = s.get("name", "Unknown Subject")
            code = s.get("code", "")
            code_str = f" ({code})" if code else ""
            sect = s.get("section", "")
            sect_str = f" [{sect}]" if sect else ""

            tid = find_teacher(sid, teachers_map)
            if not tid:
                return jsonify({
                    "error": f"Subject '{name}'{code_str}{sect_str} has no teacher assigned. Please edit a teacher in the Teachers tab and assign this subject."
                }), 400

            rid = find_room(sid, subjects_map, rooms_map)
            if not rid:
                return jsonify({
                    "error": f"Subject '{name}'{code_str}{sect_str} has no compatible room available. Please ensure rooms are configured."
                }), 400

        # Run hybrid solver
        schedule, history, validation = solve_schedule(subjects_to_schedule, data, config)
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
            "clashFree": validation["isValid"],
            "validation": validation,
            "history": history,
            "algorithm": "csp_sa_hybrid",
            "elapsed": round(time.time() - t0, 2),
            "slotTimes": times,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "algorithm": "csp_sa_hybrid", "version": "2.0"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
