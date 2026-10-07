export default function HardwareAlertNote({ title = "Hardware alerts", message = "LED and audio alert status will show here when connected." }) {
  return <div className="integration-note"><span className="note-mark">i</span><p><strong>{title}</strong><br />{message}</p></div>;
}
