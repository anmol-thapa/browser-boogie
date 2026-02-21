import { useState } from "react";
import "./dashboard.css";

type Judgement = "Perfect" | "Good" | "Ok" | "Miss";

export default function DashboardPage() {
  const [score] = useState(0);
  const [combo] = useState(0);
  const [label] = useState<Judgement>("Miss");
  const [time] = useState(0);

  return (
    <div className="dash">
      <header className="card header">JustDance CV Dashboard</header>

      <section className="card camera">Camera + Ghost Overlay Canvas</section>

      <section className="card stats">
        <h3>Live Score</h3>
        <p>Score: {score}</p>
        <p>Label: {label}</p>
        <p>Combo: {combo}</p>
        <p>Time: {time.toFixed(2)}s</p>
      </section>

      <section className="card controls">
        <h3>Routine</h3>
        <button type="button">Load Demo Routine</button>
        <button type="button">Upload routine.json</button>
        <button type="button">Start Recording</button>
        <button type="button">Download routine.json</button>
      </section>

      <section className="card audio">
        <h3>Audio</h3>
        <button type="button">Play</button>
        <button type="button">Pause</button>
      </section>
    </div>
  );
}
