// Explain the division between browser audio and the physical ESP32 alert outputs.
export default function HardwareAlertNote({ title = "Hardware alerts", message = "The ESP32 receives alert signals over Wi-Fi. Configure its network and outputs in ESP32 settings below." }) {
  return <div className="integration-note"><span className="note-mark">i</span><p><strong>{title}</strong><br />{message}</p></div>;
}
