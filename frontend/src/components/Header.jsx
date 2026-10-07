export default function Header({ children, className = "custom-header", ...props }) {
  return <header className={className} {...props}>{children}</header>;
}
