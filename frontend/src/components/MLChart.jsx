import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border2)", borderRadius:8, padding:"8px 12px", fontSize:12 }}>
      <div style={{ color:"var(--text3)", marginBottom:4 }}>Iteration {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === "number" ? Math.round(p.value) : p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export default function MLChart({ history }) {
  if (!history?.length) return null;

  const data = history.map(h => ({ x: h.iteration, score: h.penalty }));

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div className="card-title" style={{ marginBottom: "0.75rem", display:"flex", alignItems:"center", gap:8 }}>
        📈 Local-Search Optimization — Penalty vs Iteration
        <span className="badge badge-purple" style={{ marginLeft:"auto" }}>{history.length} data points</span>
      </div>

      <div className="chart-area">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="x" tick={{ fill:"#5a6e8a", fontSize:11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill:"#5a6e8a", fontSize:11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="score" name="Penalty" stroke="#4f8ef7" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize:11, color:"var(--text3)", marginTop:8 }}>
        The schedule starts from a clash-free CSP assignment, then a local-search pass swaps lecture
        slots to reduce soft-constraint penalty (lab/room mismatches, back-to-back repeats, poor day-spread).
        A penalty of 0 means the schedule is fully optimized.
      </div>
    </div>
  );
}
