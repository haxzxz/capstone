// Legacy title banner component; the current dashboard header uses Header.jsx.
export default function Header({ title }) {
  return (
    <header style={{ padding: "1rem", backgroundColor: "#1f2937", color: "white" }}>
      <h1>{title}</h1>
    </header>
  );
}
