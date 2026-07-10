export default function Tag({ label, tone = "amber" }) {
  return <span className={`b-tag b-tag-${tone}`}>{label}</span>;
}
