import { useEffect, useState } from "react";
import { apiUrl } from "../api.js";

const defaults = {
  confidence_threshold: 0.65,
  one_person_dwell_seconds: 12,
  two_person_dwell_seconds: 8,
  three_or_more_dwell_seconds: 5,
  standby_beep_delay_seconds: 1,
};

const fields = [
  ["confidence_threshold", "Minimum detection confidence", 0, 1, 0.01, "0–1", (value) => `${Math.round(value * 100)}%`],
  ["one_person_dwell_seconds", "Alert delay · 1 person", 0, 300, 1, "sec", (value) => `${value} sec`],
  ["two_person_dwell_seconds", "Alert delay · 2 people", 0, 300, 1, "sec", (value) => `${value} sec`],
  ["three_or_more_dwell_seconds", "Alert delay · 3+ people", 0, 300, 1, "sec", (value) => `${value} sec`],
  ["standby_beep_delay_seconds", "Standby beep interval", 0, 60, 0.5, "sec", (value) => `${value} sec`],
];

export default function AlertSettingsPanel() {
  const [values, setValues] = useState(defaults);
  const [status, setStatus] = useState("Loading alert settings…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/api/alert-settings"))
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load settings from the detection service.");
        return response.json();
      })
      .then((settings) => {
        if (active) { setValues({ ...defaults, ...settings }); setStatus(""); }
      })
      .catch((error) => { if (active) setStatus(error.message); });
    return () => { active = false; };
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch(apiUrl("/api/alert-settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not save alert settings.");
      setValues({ ...defaults, ...result });
      setStatus("Alert settings saved and active.");
    } catch (error) {
      setStatus(error.message || "Could not save alert settings.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel alert-settings-panel" aria-label="Alert settings">
    <div className="panel-heading"><div><div className="section-kicker">DETECTION AND SOUND</div><h2>Alert settings</h2></div></div>
    <p className="alert-settings-description">Changes apply to this detection service and are saved across restarts.</p>
    <form onSubmit={save}>
      {fields.map(([key, label, min, max, step, unit, format]) => <label className="alert-setting-field" key={key} htmlFor={`alert-setting-${key}`}>
        <span>{label}<small>{format(values[key])}</small></span>
        <input id={`alert-setting-${key}`} type="number" min={min} max={max} step={step} required value={values[key]} disabled={saving} onChange={(event) => setValues((current) => ({ ...current, [key]: Number(event.target.value) }))} />
        <em>{unit}</em>
      </label>)}
      <p className="alert-settings-hint">A 0 second delay triggers immediately. Confidence is the minimum score required to accept a person detection.</p>
      <button className="alert-settings-save" type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
    </form>
    {status && <p className="alert-settings-status" role="status">{status}</p>}
  </section>;
}
