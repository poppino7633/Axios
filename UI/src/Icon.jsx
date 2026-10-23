// Iconițele din assets/icons sunt inserate direct în pagină (inline), nu prin <img>, ca să preia
// culoarea textului (currentColor): așa devin automat albe/negre în modul High Contrast.
const ICONS = import.meta.glob('./assets/icons/*.svg', { query: '?raw', import: 'default', eager: true });

export default function Icon({ name, size = 20, className = '', label }) {
  const svg = ICONS[`./assets/icons/${name}.svg`];
  if (!svg) {
    console.warn(`[Axios] Iconiță lipsă: ${name}`);
    return null;
  }

  return (
    <span
      className={`icon ${className}`}
      style={{ width: size, height: size }}
      // fără label: iconița e decorativă (textul de lângă ea spune deja ce înseamnă)
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
