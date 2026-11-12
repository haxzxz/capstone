// Explain the division between browser audio and the physical ESP32 alert outputs.
export default function HardwareAlertNote({ title = "Hardware alerts", message = "The ESP32 receives alert signals over Wi-Fi. Set its network, backend address, and output pins in the hardware firmware before uploading." }) {
  return <div className="integration-note"><span className="note-mark">i</span><p><strong>{title}</strong><br />{message}</p></div>;
}
