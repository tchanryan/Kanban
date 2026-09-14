import { colors, type Tag } from '../domain/model';
export function ColorPicker({
  value,
  onChange,
  label = 'Tag colour',
}: {
  value: Tag['colorToken'];
  onChange: (color: Tag['colorToken']) => void;
  label?: string;
}) {
  return (
    <div className="color-swatches" role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch color-${color}`}
          aria-label={color}
          aria-pressed={value === color}
          title={color}
          onClick={() => onChange(color)}
        >
          <span />
        </button>
      ))}
    </div>
  );
}
