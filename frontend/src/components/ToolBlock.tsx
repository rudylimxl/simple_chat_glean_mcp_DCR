import { useState } from "react";
import "./ToolBlock.css";

interface ToolBlockProps {
  label: string;
  content: string;
}

export default function ToolBlock({ label, content }: ToolBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="tool-block">
      <button
        type="button"
        className="tool-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
        <span className={`tool-chevron${open ? " open" : ""}`}>▾</span>
      </button>
      {open && <pre className="tool-content">{content}</pre>}
    </div>
  );
}
