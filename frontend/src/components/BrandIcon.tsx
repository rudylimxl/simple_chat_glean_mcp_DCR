interface BrandIconProps {
  size?: "default" | "large";
}

export default function BrandIcon({ size = "default" }: BrandIconProps) {
  return (
    <img
      src="/glean-icon.png"
      alt="Glean"
      className={`brand-icon${size === "large" ? " brand-icon-large" : ""}`}
    />
  );
}
